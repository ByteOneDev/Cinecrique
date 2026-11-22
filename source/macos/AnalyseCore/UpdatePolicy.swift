import Foundation

/// Rules for the automatic updater.
///
/// A release publishes `cinecrique-update.json` next to its DMG. The manifest
/// carries the DMG size and SHA-256 and an Ed25519 signature of
/// `signedMessage`, made with a private key that never leaves the release
/// machine. The application embeds the matching public key: a manifest or a DMG
/// that does not match is rejected before anything is mounted or installed.
public enum UpdatePolicy {
    public static let schema = 1
    public static let manifestMaximumBytes = 256 * 1_024
    public static let maximumDMGBytes: Int64 = 2 * 1_024 * 1_024 * 1_024
    public static let checkInterval: TimeInterval = 24 * 60 * 60
    public static let allowedDownloadHosts: Set<String> = [
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    ]

    public struct Manifest: Equatable {
        public let version: String
        public let build: String
        public let notes: String
        public let publishedAt: String
        public let minimumSystemVersion: String
        public let releaseURL: URL?
        public let downloadURL: URL
        public let size: Int64
        public let sha256: String
        public let signature: Data
    }

    /// Compares dotted numeric versions (`1.10.0` > `1.9.2`). A leading `v` and
    /// any pre-release suffix are ignored.
    public static func compareVersions(_ left: String, _ right: String) -> Int {
        func parts(_ value: String) -> [Int] {
            var trimmed = value.trimmingCharacters(in: .whitespaces)
            if trimmed.lowercased().hasPrefix("v") { trimmed.removeFirst() }
            let core = trimmed.split(separator: "-", maxSplits: 1).first.map(String.init) ?? ""
            return core.split(separator: ".").map { Int($0) ?? 0 }
        }
        let a = parts(left)
        let b = parts(right)
        for index in 0..<max(a.count, b.count, 3) {
            let difference = (index < a.count ? a[index] : 0) - (index < b.count ? b[index] : 0)
            if difference != 0 { return difference > 0 ? 1 : -1 }
        }
        return 0
    }

    public static func isValidVersion(_ value: String) -> Bool {
        let pattern = #"^\d{1,4}(\.\d{1,4}){1,3}$"#
        return value.range(of: pattern, options: .regularExpression) != nil
    }

    public static func signedMessage(version: String, size: Int64, sha256: String) -> Data {
        Data("cinecrique-update-v\(schema)\n\(version)\n\(size)\n\(sha256.lowercased())\n".utf8)
    }

    public static func shouldCheck(lastCheck: Date?, now: Date, enabled: Bool) -> Bool {
        guard enabled else { return false }
        guard let lastCheck else { return true }
        return now.timeIntervalSince(lastCheck) >= checkInterval || now < lastCheck
    }

    public static func isAllowedDownloadURL(_ url: URL) -> Bool {
        guard
            url.scheme?.lowercased() == "https",
            let host = url.host?.lowercased(),
            allowedDownloadHosts.contains(host),
            url.user == nil,
            url.password == nil,
            url.port == nil
        else { return false }
        return true
    }

    public static func parseManifest(_ data: Data) throws -> Manifest {
        guard data.count <= manifestMaximumBytes else { throw UpdateError.invalidManifest }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw UpdateError.invalidManifest
        }
        guard (root["schema"] as? NSNumber)?.intValue == schema else { throw UpdateError.unsupportedManifest }
        guard
            let version = root["version"] as? String, isValidVersion(version),
            let dmg = root["dmg"] as? [String: Any],
            let rawURL = dmg["url"] as? String,
            let downloadURL = URL(string: rawURL),
            isAllowedDownloadURL(downloadURL),
            let size = (dmg["size"] as? NSNumber)?.int64Value,
            size > 0, size <= maximumDMGBytes,
            let sha256 = (dmg["sha256"] as? String)?.lowercased(),
            sha256.count == 64, sha256.allSatisfy(\.isHexDigit),
            let rawSignature = root["signature"] as? String,
            let signature = Data(base64Encoded: rawSignature),
            signature.count == 64
        else { throw UpdateError.invalidManifest }

        let releaseURL = (root["releaseURL"] as? String).flatMap(URL.init(string:)).flatMap { isAllowedDownloadURL($0) ? $0 : nil }
        return Manifest(
            version: version,
            build: String((root["build"] as? String ?? "").prefix(32)),
            notes: String((root["notes"] as? String ?? "").prefix(20_000)),
            publishedAt: String((root["publishedAt"] as? String ?? "").prefix(64)),
            minimumSystemVersion: String((root["minimumSystemVersion"] as? String ?? "13.0").prefix(16)),
            releaseURL: releaseURL,
            downloadURL: downloadURL,
            size: size,
            sha256: sha256,
            signature: signature
        )
    }

    /// Release information from the GitHub API, used only to *announce* a new
    /// version when no signed manifest is published. Nothing is installed from it.
    public static func parseGitHubRelease(_ data: Data) -> (version: String, notes: String, releaseURL: URL?)? {
        guard
            data.count <= 2 * 1_024 * 1_024,
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            root["draft"] as? Bool != true,
            root["prerelease"] as? Bool != true
        else { return nil }
        let rawTag = (root["tag_name"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let tag = rawTag.lowercased().hasPrefix("v") ? String(rawTag.dropFirst()) : rawTag
        let name = (root["name"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let version = isValidVersion(tag) ? tag : name.split(separator: " ").map(String.init).first(where: isValidVersion) ?? ""
        guard !version.isEmpty else { return nil }
        let releaseURL = (root["html_url"] as? String).flatMap(URL.init(string:)).flatMap { isAllowedDownloadURL($0) ? $0 : nil }
        return (version, String((root["body"] as? String ?? "").prefix(20_000)), releaseURL)
    }

    /// The application must be replaceable in place: not running from a
    /// read-only disk image or from Gatekeeper's translocated copy.
    public static func installLocationProblem(bundlePath: String, parentWritable: Bool) -> String? {
        if bundlePath.contains("/AppTranslocation/") {
            return "Déplacez Cinécrique dans le dossier Applications puis relancez-le pour activer les mises à jour."
        }
        if bundlePath.hasPrefix("/Volumes/") {
            return "Cinécrique est lancé depuis l’image disque : copiez-le dans Applications pour activer les mises à jour."
        }
        if !parentWritable {
            return "Le dossier qui contient Cinécrique n’est pas modifiable : la mise à jour ne peut pas remplacer l’application."
        }
        return nil
    }
}

public enum UpdateError: LocalizedError, Equatable {
    case notConfigured
    case invalidManifest
    case unsupportedManifest
    case invalidSignature
    case checksumMismatch
    case sizeMismatch
    case wrongApplication
    case signatureCheckFailed
    case teamMismatch
    case systemTooOld(String)
    case installLocation(String)
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured: return "Les mises à jour automatiques ne sont pas configurées dans cette version."
        case .invalidManifest: return "Les informations de mise à jour publiées sont invalides."
        case .unsupportedManifest: return "Cette mise à jour demande une version plus récente du programme de mise à jour."
        case .invalidSignature: return "La signature de la mise à jour est invalide : elle a été rejetée."
        case .checksumMismatch: return "Le fichier téléchargé ne correspond pas à son empreinte : il a été supprimé."
        case .sizeMismatch: return "La taille du fichier téléchargé ne correspond pas à la mise à jour annoncée."
        case .wrongApplication: return "L’image disque ne contient pas la version attendue de Cinécrique."
        case .signatureCheckFailed: return "La signature de code de la nouvelle version est invalide."
        case .teamMismatch: return "La nouvelle version n’est pas signée par le même développeur."
        case .systemTooOld(let version): return "Cette mise à jour demande macOS \(version) ou plus récent."
        case .installLocation(let message): return message
        case .failed(let message): return message
        }
    }
}
