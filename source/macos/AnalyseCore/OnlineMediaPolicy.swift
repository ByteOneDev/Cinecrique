import Foundation

/// Rules for importing a video from a web page through yt-dlp.
///
/// Everything that decides *what* is sent to the download engine lives here so
/// it can be checked without a network: the page address is validated, the
/// options come from closed lists, and the address is always passed after `--`
/// so it can never be read as an option.
public enum OnlineMediaPolicy {
    public static let maximumURLBytes = 2_048
    public static let qualities: Set<String> = ["best", "2160", "1080", "720", "480"]
    public static let cookieBrowsers: Set<String> = [
        "safari", "chrome", "firefox", "brave", "edge", "chromium", "vivaldi", "opera",
    ]
    public static let progressPrefix = "[cinecrique-progress]"
    public static let filePrefix = "[cinecrique-file]"
    public static let outputTemplate = "%(title).120B [%(id).40B].%(ext)s"
    public static let downloadTimeout: TimeInterval = 6 * 60 * 60
    public static let toolDownloadURL = URL(string: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos")!
    public static let toolChecksumsURL = URL(string: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS")!
    public static let toolAssetName = "yt-dlp_macos"
    public static let toolMaximumBytes = 120 * 1_024 * 1_024

    public struct Request: Equatable {
        public let url: URL
        public let quality: String
        public let cookiesBrowser: String?
        public let subtitles: Bool

        public init(url: URL, quality: String, cookiesBrowser: String?, subtitles: Bool) {
            self.url = url
            self.quality = quality
            self.cookiesBrowser = cookiesBrowser
            self.subtitles = subtitles
        }
    }

    public struct Progress: Equatable {
        public let downloadedBytes: Double
        public let totalBytes: Double?
        public let bytesPerSecond: Double?

        public var fraction: Double? {
            guard let totalBytes, totalBytes > 0 else { return nil }
            return min(max(downloadedBytes / totalBytes, 0), 1)
        }
    }

    public static func request(
        rawURL: String,
        quality rawQuality: String?,
        cookiesBrowser rawBrowser: String?,
        subtitles: Bool
    ) throws -> Request {
        guard let url = validatedPageURL(rawURL) else { throw OnlineMediaError.invalidURL }
        let quality = rawQuality.flatMap { qualities.contains($0) ? $0 : nil } ?? "1080"
        let browser = rawBrowser.flatMap { cookieBrowsers.contains($0) ? $0 : nil }
        return Request(url: url, quality: quality, cookiesBrowser: browser, subtitles: subtitles)
    }

    public static func validatedPageURL(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !trimmed.isEmpty,
            trimmed.utf8.count <= maximumURLBytes,
            trimmed.rangeOfCharacter(from: CharacterSet.whitespacesAndNewlines.union(.controlCharacters)) == nil,
            !trimmed.hasPrefix("-"),
            let components = URLComponents(string: trimmed),
            let scheme = components.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            components.user == nil,
            components.password == nil,
            let host = components.host?.lowercased(),
            !host.isEmpty,
            !isLocalHost(host),
            let url = components.url
        else { return nil }
        return url
    }

    public static func isLocalHost(_ rawHost: String) -> Bool {
        let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || host.hasSuffix(".internal") {
            return true
        }
        if host.contains(":") {
            return host == "::1" || host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe80")
        }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }) else { return false }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return true }
        switch (octets[0], octets[1]) {
        case (10, _), (127, _), (0, _), (169, 254), (192, 168): return true
        case (172, 16...31): return true
        default: return false
        }
    }

    /// Prefers H.264 + AAC so the result usually plays directly, then falls back
    /// to whatever the site offers; the local proxy handles the rest.
    public static func formatSelector(quality: String) -> String {
        let cap = quality == "best" || !qualities.contains(quality) ? "" : "[height<=\(quality)]"
        return [
            "bv*\(cap)[vcodec^=avc1]+ba[acodec^=mp4a]",
            "bv*\(cap)+ba",
            "b\(cap)",
            "bv*+ba",
            "b",
        ].joined(separator: "/")
    }

    public static func arguments(
        request: Request,
        outputDirectory: URL,
        ffmpegDirectory: URL?
    ) -> [String] {
        var arguments = [
            "--ignore-config",
            "--no-playlist",
            "--no-exec",
            // A failed subtitle or thumbnail (YouTube often answers 429) must not
            // abort the video itself; the result is judged on the produced file.
            "--ignore-errors",
            "--no-mtime",
            "--newline",
            "--progress",
            "--progress-template", "download:\(progressPrefix) %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s",
            "--print", "after_move:\(filePrefix) %(filepath)s",
            "--downloader", "m3u8:native",
            "--socket-timeout", "30",
            "--retries", "5",
            "--fragment-retries", "10",
            "--concurrent-fragments", "4",
            "--trim-filenames", "160",
            "--write-info-json",
            "--write-thumbnail",
            "--convert-thumbnails", "jpg",
            "-f", formatSelector(quality: request.quality),
            "--merge-output-format", "mp4/mkv",
            "-P", outputDirectory.path,
            "-o", outputTemplate,
        ]
        if request.subtitles {
            arguments += [
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs", "fr.*,en.*,-live_chat",
                "--convert-subs", "srt",
            ]
        }
        if let ffmpegDirectory {
            arguments += ["--ffmpeg-location", ffmpegDirectory.path]
        }
        if let browser = request.cookiesBrowser {
            arguments += ["--cookies-from-browser", browser]
        }
        arguments += ["--", request.url.absoluteString]
        return arguments
    }

    public static func parseProgress(_ line: String) -> Progress? {
        guard let range = line.range(of: progressPrefix) else { return nil }
        let fields = line[range.upperBound...].split(separator: " ").map(String.init)
        guard fields.count >= 3, let downloaded = Double(fields[0]), downloaded >= 0 else { return nil }
        let total = Double(fields[1]).flatMap { $0 > 0 ? $0 : nil } ?? Double(fields[2]).flatMap { $0 > 0 ? $0 : nil }
        let speed = fields.count >= 4 ? Double(fields[3]).flatMap { $0 > 0 ? $0 : nil } : nil
        return Progress(downloadedBytes: downloaded, totalBytes: total, bytesPerSecond: speed)
    }

    /// Final file printed by yt-dlp once every post-processor has run. It must
    /// stay inside the download folder.
    public static func parseOutputFile(_ line: String, outputDirectory: URL) -> URL? {
        guard let range = line.range(of: filePrefix) else { return nil }
        let path = line[range.upperBound...].trimmingCharacters(in: .whitespaces)
        guard !path.isEmpty, path.utf8.count <= 16_384 else { return nil }
        let candidate = URL(fileURLWithPath: path).standardizedFileURL
        let root = outputDirectory.standardizedFileURL.path
        let prefix = root.hasSuffix("/") ? root : root + "/"
        return candidate.path.hasPrefix(prefix) ? candidate : nil
    }

    /// The SHA2-256SUMS file of a yt-dlp release lists `<hash>  <asset>`.
    public static func expectedChecksum(in sums: String, asset: String = toolAssetName) -> String? {
        for line in sums.split(whereSeparator: \.isNewline) {
            let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            guard fields.count >= 2 else { continue }
            let name = fields[fields.count - 1].trimmingCharacters(in: CharacterSet(charactersIn: "*"))
            let hash = fields[0].lowercased()
            if name == asset, hash.count == 64, hash.allSatisfy(\.isHexDigit) { return hash }
        }
        return nil
    }

    /// Short, readable error from yt-dlp's standard error, without local paths.
    public static func readableError(from output: String) -> String {
        let lines = output.split(whereSeparator: \.isNewline).map(String.init)
        let error = lines.last(where: { $0.hasPrefix("ERROR:") }) ?? lines.last(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) ?? ""
        var message = error.replacingOccurrences(of: "ERROR: ", with: "")
        if let home = ProcessInfo.processInfo.environment["HOME"], !home.isEmpty {
            message = message.replacingOccurrences(of: home, with: "~")
        }
        if message.localizedCaseInsensitiveContains("drm") {
            return "Cette vidéo est protégée par DRM : elle ne peut pas être téléchargée."
        }
        if message.localizedCaseInsensitiveContains("Unsupported URL") {
            return "Aucune vidéo reconnue sur cette page."
        }
        if message.localizedCaseInsensitiveContains("Sign in") || message.localizedCaseInsensitiveContains("login") {
            return "Ce site demande une connexion : choisissez le navigateur où vous êtes connecté dans « Cookies du navigateur »."
        }
        let trimmed = String(message.prefix(400)).trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "Le téléchargement a échoué." : trimmed
    }
}

public enum OnlineMediaError: LocalizedError, Equatable {
    case invalidURL
    case toolUnavailable
    case toolChecksumMismatch
    case toolDownloadFailed(String)
    case downloadFailed(String)
    case outputMissing
    case cancelled

    public var errorDescription: String? {
        switch self {
        case .invalidURL: return "Cette adresse n’est pas une page web publique valide."
        case .toolUnavailable: return "Le moteur de téléchargement yt-dlp n’est pas installé."
        case .toolChecksumMismatch: return "Le moteur téléchargé ne correspond pas à son empreinte publiée ; il a été supprimé."
        case .toolDownloadFailed(let message): return "Installation du moteur impossible : \(message)"
        case .downloadFailed(let message): return message
        case .outputMissing: return "Le téléchargement s’est terminé sans produire de fichier vidéo."
        case .cancelled: return "Téléchargement annulé."
        }
    }
}
