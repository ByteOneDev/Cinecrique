import AppKit
import CryptoKit
import Foundation
import Security
import AnalyseCore

/// Automatic updates.
///
/// 1. Reads the signed manifest published with the latest release.
/// 2. Downloads the DMG, checks its size, SHA-256 and the Ed25519 signature of
///    the manifest with the public key embedded in Info.plist.
/// 3. Mounts the image read-only, checks the bundle identifier, the version and
///    the code signature (same Team ID when the running copy has one), copies
///    the new application next to the current one and detaches the image.
/// 4. Quits through the normal path (projects are flushed), and a small helper
///    swaps the bundles once Cinécrique has exited, then relaunches it. If the
///    swap fails, the previous application is put back.
final class UpdateService {
    private static let autoUpdateKey = "Cinecrique.AutoUpdate"
    private static let lastCheckKey = "Cinecrique.LastUpdateCheck"

    var onStateChange: (([String: Any]) -> Void)?

    private let queue = DispatchQueue(label: "app.analyse.updates", qos: .utility)
    private let lock = NSLock()
    private var state: [String: Any] = ["stage": "idle"]
    private var manifest: UpdatePolicy.Manifest?
    private var busy = false
    private let defaults = UserDefaults.standard
    private let updatesDirectory: URL

    init(applicationSupportDirectory: URL) {
        updatesDirectory = applicationSupportDirectory.appendingPathComponent("Updates", isDirectory: true)
        let directory = updatesDirectory
        queue.async { Self.removeLeftovers(updatesDirectory: directory) }
    }

    /// An interrupted update can leave a downloaded image, an install script or a
    /// hidden staging copy next to the application: remove them at the next launch.
    private static func removeLeftovers(updatesDirectory: URL) {
        let fileManager = FileManager.default
        if let items = try? fileManager.contentsOfDirectory(at: updatesDirectory, includingPropertiesForKeys: nil) {
            for item in items { try? fileManager.removeItem(at: item) }
        }
        let parent = Bundle.main.bundleURL.standardizedFileURL.deletingLastPathComponent()
        let limit = Date().addingTimeInterval(-3_600)
        guard let siblings = try? fileManager.contentsOfDirectory(
            at: parent,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: []
        ) else { return }
        for item in siblings where item.lastPathComponent.hasPrefix(".Cinecrique-update-") {
            let modified = (try? item.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
            if modified < limit { try? fileManager.removeItem(at: item) }
        }
    }

    // MARK: - Configuration

    var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    private var feedURL: URL? {
        (Bundle.main.object(forInfoDictionaryKey: "CinecriqueUpdateFeedURL") as? String)
            .flatMap(URL.init(string:))
            .flatMap { UpdatePolicy.isAllowedDownloadURL($0) ? $0 : nil }
    }

    private var releasesAPIURL: URL? {
        (Bundle.main.object(forInfoDictionaryKey: "CinecriqueReleasesAPIURL") as? String)
            .flatMap(URL.init(string:))
            .flatMap { url in
                url.scheme == "https" && url.host?.lowercased() == "api.github.com" ? url : nil
            }
    }

    private var publicKey: Curve25519.Signing.PublicKey? {
        guard
            let encoded = Bundle.main.object(forInfoDictionaryKey: "CinecriqueUpdatePublicKey") as? String,
            let data = Data(base64Encoded: encoded.trimmingCharacters(in: .whitespacesAndNewlines)),
            data.count == 32
        else { return nil }
        return try? Curve25519.Signing.PublicKey(rawRepresentation: data)
    }

    var autoUpdateEnabled: Bool {
        get { defaults.object(forKey: Self.autoUpdateKey) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Self.autoUpdateKey) }
    }

    func snapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        var value = state
        value["currentVersion"] = currentVersion
        value["autoUpdate"] = autoUpdateEnabled
        return value
    }

    private func publish(_ next: [String: Any], announce: Bool = false) {
        lock.lock()
        state = next
        lock.unlock()
        var event = snapshot()
        if announce { event["announce"] = true }
        onStateChange?(event)
    }

    // MARK: - Check

    func checkAutomaticallyIfDue() {
        let last = defaults.object(forKey: Self.lastCheckKey) as? Date
        guard UpdatePolicy.shouldCheck(lastCheck: last, now: Date(), enabled: autoUpdateEnabled) else { return }
        queue.asyncAfter(deadline: .now() + 6) { [weak self] in
            self?.performCheck(announce: true)
        }
    }

    func check(completion: @escaping ([String: Any]) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            self.performCheck(announce: false)
            completion(self.snapshot())
        }
    }

    private func performCheck(announce: Bool) {
        lock.lock()
        if busy {
            lock.unlock()
            return
        }
        busy = true
        lock.unlock()
        defer {
            lock.lock()
            busy = false
            lock.unlock()
        }

        publish(["stage": "checking", "message": "Recherche de la dernière version publiée"])
        defaults.set(Date(), forKey: Self.lastCheckKey)
        do {
            if let feedURL, let data = try? Self.fetch(feedURL, maximumBytes: UpdatePolicy.manifestMaximumBytes) {
                let manifest = try UpdatePolicy.parseManifest(data)
                self.manifest = manifest
                guard UpdatePolicy.compareVersions(manifest.version, currentVersion) > 0 else {
                    publish(["stage": "up-to-date", "message": "Cinécrique \(currentVersion) est la dernière version."])
                    return
                }
                let location = installLocationProblem()
                let canInstall = publicKey != nil && location == nil
                publish([
                    "stage": "available",
                    "version": manifest.version,
                    "notes": manifest.notes,
                    "releaseURL": manifest.releaseURL?.absoluteString ?? "",
                    "canInstall": canInstall,
                    "message": canInstall
                        ? "Téléchargement, vérification de la signature et redémarrage automatiques."
                        : location ?? UpdateError.notConfigured.localizedDescription,
                ], announce: announce)
                return
            }
            guard let api = releasesAPIURL else { throw UpdateError.notConfigured }
            let data = try Self.fetch(api, maximumBytes: 2 * 1_024 * 1_024, accept: "application/vnd.github+json")
            guard let release = UpdatePolicy.parseGitHubRelease(data) else { throw UpdateError.invalidManifest }
            manifest = nil
            guard UpdatePolicy.compareVersions(release.version, currentVersion) > 0 else {
                publish(["stage": "up-to-date", "message": "Cinécrique \(currentVersion) est la dernière version."])
                return
            }
            publish([
                "stage": "available",
                "version": release.version,
                "notes": release.notes,
                "releaseURL": release.releaseURL?.absoluteString ?? "",
                "canInstall": false,
                "message": "Cette version n’est pas accompagnée d’une mise à jour signée : téléchargez-la depuis sa page.",
            ], announce: announce)
        } catch {
            publish(["stage": "failed", "message": error.localizedDescription])
        }
    }

    // MARK: - Install

    func install(completion: @escaping ([String: Any]) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            var responded = false
            let respond = {
                guard !responded else { return }
                responded = true
                completion(self.snapshot())
            }
            do {
                guard let manifest = self.manifest, let key = self.publicKey else { throw UpdateError.notConfigured }
                if let problem = self.installLocationProblem() { throw UpdateError.installLocation(problem) }
                let system = ProcessInfo.processInfo.operatingSystemVersion
                let systemVersion = "\(system.majorVersion).\(system.minorVersion).\(system.patchVersion)"
                guard UpdatePolicy.compareVersions(systemVersion, manifest.minimumSystemVersion) >= 0 else {
                    throw UpdateError.systemTooOld(manifest.minimumSystemVersion)
                }
                let message = UpdatePolicy.signedMessage(version: manifest.version, size: manifest.size, sha256: manifest.sha256)
                guard key.isValidSignature(manifest.signature, for: message) else { throw UpdateError.invalidSignature }

                self.publish(["stage": "downloading", "version": manifest.version, "progress": 0, "message": "Téléchargement de Cinécrique \(manifest.version)"])
                respond()
                let dmg = try self.download(manifest)
                defer { try? FileManager.default.removeItem(at: dmg) }
                self.publish(["stage": "verifying", "version": manifest.version, "progress": 1, "message": "Vérification de l’empreinte et de la signature"])
                try Self.verify(dmg, manifest: manifest)
                self.publish(["stage": "installing", "version": manifest.version, "progress": 1, "message": "Préparation de la nouvelle version"])
                let staged = try self.stageApplication(from: dmg, manifest: manifest)
                try self.launchSwapHelper(staged: staged)
                self.publish(["stage": "ready", "version": manifest.version, "message": "Redémarrage de Cinécrique…"])
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    NSApp.terminate(nil)
                }
            } catch {
                self.publish(["stage": "failed", "message": error.localizedDescription])
                respond()
            }
        }
    }

    private func installLocationProblem() -> String? {
        let bundle = Bundle.main.bundleURL.standardizedFileURL
        guard bundle.pathExtension == "app" else {
            return "Cette copie de développement ne peut pas se mettre à jour elle-même."
        }
        let parent = bundle.deletingLastPathComponent()
        return UpdatePolicy.installLocationProblem(
            bundlePath: bundle.path,
            parentWritable: FileManager.default.isWritableFile(atPath: parent.path)
        )
    }

    private func download(_ manifest: UpdatePolicy.Manifest) throws -> URL {
        try FileManager.default.createDirectory(at: updatesDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let destination = updatesDirectory.appendingPathComponent("Cinecrique-\(manifest.version)-\(UUID().uuidString).dmg")
        let delegate = DownloadDelegate(expectedBytes: manifest.size) { [weak self] fraction in
            self?.publish(["stage": "downloading", "version": manifest.version, "progress": fraction, "message": "Téléchargement de Cinécrique \(manifest.version)"])
        }
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: manifest.downloadURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
        request.setValue("Cinecrique/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        session.downloadTask(with: request).resume()
        guard delegate.wait(timeout: 60 * 60) else { throw UpdateError.failed("Le téléchargement de la mise à jour a expiré.") }
        guard let temporary = delegate.fileURL else {
            throw UpdateError.failed(delegate.errorMessage ?? "Le téléchargement de la mise à jour a échoué.")
        }
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    private static func verify(_ dmg: URL, manifest: UpdatePolicy.Manifest) throws {
        let values = try dmg.resourceValues(forKeys: [.fileSizeKey])
        guard Int64(values.fileSize ?? -1) == manifest.size else {
            try? FileManager.default.removeItem(at: dmg)
            throw UpdateError.sizeMismatch
        }
        let handle = try FileHandle(forReadingFrom: dmg)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = handle.readData(ofLength: 4 * 1_024 * 1_024)
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        guard digest == manifest.sha256 else {
            try? FileManager.default.removeItem(at: dmg)
            throw UpdateError.checksumMismatch
        }
    }

    private func stageApplication(from dmg: URL, manifest: UpdatePolicy.Manifest) throws -> URL {
        let mountPoint = updatesDirectory.appendingPathComponent("mount-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: mountPoint, withIntermediateDirectories: true)
        try Self.run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-noverify", "-mountpoint", mountPoint.path, dmg.path], timeout: 300)
        defer {
            _ = try? Self.run("/usr/bin/hdiutil", ["detach", "-force", mountPoint.path], timeout: 120)
            try? FileManager.default.removeItem(at: mountPoint)
        }

        let candidates = (try? FileManager.default.contentsOfDirectory(at: mountPoint, includingPropertiesForKeys: [.isSymbolicLinkKey])) ?? []
        guard let newApp = candidates.first(where: { url in
            guard url.pathExtension == "app", (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true else { return false }
            let info = Bundle(url: url)?.infoDictionary
            return info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier
                && info?["CFBundleShortVersionString"] as? String == manifest.version
        }) else { throw UpdateError.wrongApplication }

        try Self.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp.path], timeout: 300)
        if let team = Self.teamIdentifier(of: Bundle.main.bundleURL) {
            guard Self.teamIdentifier(of: newApp) == team else { throw UpdateError.teamMismatch }
        }

        let current = Bundle.main.bundleURL.standardizedFileURL
        let stagingDirectory = current.deletingLastPathComponent()
            .appendingPathComponent(".Cinecrique-update-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: stagingDirectory, withIntermediateDirectories: false)
        let staged = stagingDirectory.appendingPathComponent(current.lastPathComponent, isDirectory: true)
        do {
            try Self.run("/usr/bin/ditto", ["--norsrc", newApp.path, staged.path], timeout: 600)
            try Self.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged.path], timeout: 300)
        } catch {
            try? FileManager.default.removeItem(at: stagingDirectory)
            throw error
        }
        return staged
    }

    private func launchSwapHelper(staged: URL) throws {
        let current = Bundle.main.bundleURL.standardizedFileURL
        let backup = current.deletingLastPathComponent()
            .appendingPathComponent(".Cinecrique-previous-\(UUID().uuidString).app", isDirectory: true)
        let script = updatesDirectory.appendingPathComponent("install-\(UUID().uuidString).sh")
        // Paths are passed as arguments, never interpolated into the script.
        let body = """
        #!/bin/sh
        PID="$1"; CURRENT="$2"; STAGED="$3"; BACKUP="$4"; STAGING_DIR="$(dirname "$STAGED")"
        i=0
        while kill -0 "$PID" 2>/dev/null; do
          i=$((i + 1))
          [ "$i" -gt 600 ] && exit 1
          sleep 0.2
        done
        if /bin/mv "$CURRENT" "$BACKUP"; then
          if /bin/mv "$STAGED" "$CURRENT"; then
            /bin/rm -rf "$BACKUP"
          else
            /bin/mv "$BACKUP" "$CURRENT"
          fi
        fi
        /bin/rm -rf "$STAGING_DIR"
        /usr/bin/open "$CURRENT"
        /bin/rm -f "$0"
        """
        try Data(body.utf8).write(to: script, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, String(ProcessInfo.processInfo.processIdentifier), current.path, staged.path, backup.path]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    // MARK: - Helpers

    private static func teamIdentifier(of bundle: URL) -> String? {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(bundle as CFURL, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var information: CFDictionary?
        guard
            SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
            let dictionary = information as? [String: Any]
        else { return nil }
        let team = dictionary[kSecCodeInfoTeamIdentifier as String] as? String
        return team?.isEmpty == false ? team : nil
    }

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String], timeout: TimeInterval) throws -> Int32 {
        let status = try BoundedProcessRunner.streamStandardOutput(
            executableURL: URL(fileURLWithPath: executable),
            arguments: arguments,
            timeout: timeout
        ) { _ in }
        guard status == 0 else {
            throw UpdateError.failed("L’étape « \(URL(fileURLWithPath: executable).lastPathComponent) » de la mise à jour a échoué.")
        }
        return status
    }

    private static func fetch(_ url: URL, maximumBytes: Int, accept: String? = nil) throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Cinecrique", forHTTPHeaderField: "User-Agent")
        if let accept { request.setValue(accept, forHTTPHeaderField: "Accept") }
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Data, Error> = .failure(UpdateError.failed("Le serveur de mises à jour ne répond pas."))
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error {
                result = .failure(UpdateError.failed(error.localizedDescription))
                return
            }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                result = .failure(UpdateError.failed("Aucune mise à jour publiée n’a été trouvée."))
                return
            }
            guard data.count <= maximumBytes else {
                result = .failure(UpdateError.invalidManifest)
                return
            }
            result = .success(data)
        }
        task.resume()
        if semaphore.wait(timeout: .now() + 60) == .timedOut {
            task.cancel()
            throw UpdateError.failed("Le serveur de mises à jour ne répond pas.")
        }
        return try result.get()
    }

    private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
        private let expectedBytes: Int64
        private let onProgress: (Double) -> Void
        private let done = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var lastReported = -1.0
        private(set) var fileURL: URL?
        private(set) var errorMessage: String?

        init(expectedBytes: Int64, onProgress: @escaping (Double) -> Void) {
            self.expectedBytes = expectedBytes
            self.onProgress = onProgress
        }

        func wait(timeout: TimeInterval) -> Bool {
            done.wait(timeout: .now() + timeout) == .success
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            guard let url = request.url, UpdatePolicy.isAllowedDownloadURL(url) else {
                completionHandler(nil)
                return
            }
            completionHandler(request)
        }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
            if totalBytesWritten > expectedBytes {
                downloadTask.cancel()
                return
            }
            let fraction = Double(totalBytesWritten) / Double(max(expectedBytes, 1))
            lock.lock()
            let shouldReport = fraction - lastReported >= 0.01
            if shouldReport { lastReported = fraction }
            lock.unlock()
            if shouldReport { onProgress(min(max(fraction, 0), 1)) }
        }

        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
            guard let http = downloadTask.response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                errorMessage = "Le serveur a refusé le téléchargement de la mise à jour."
                return
            }
            // The temporary file disappears when this method returns: keep a copy.
            let kept = FileManager.default.temporaryDirectory.appendingPathComponent("cinecrique-update-\(UUID().uuidString).dmg")
            do {
                try FileManager.default.moveItem(at: location, to: kept)
                fileURL = kept
            } catch {
                errorMessage = error.localizedDescription
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if let error, fileURL == nil { errorMessage = error.localizedDescription }
            done.signal()
        }
    }
}
