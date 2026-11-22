import CryptoKit
import Darwin
import Foundation
import AnalyseCore

/// Downloads a video from a web page with yt-dlp, then hands the local file to
/// the regular media pipeline (ffprobe, proxy, project). yt-dlp is either the
/// copy managed by Cinécrique in Application Support (installed and updated on
/// request, checked against the SHA-256 published with each release) or a copy
/// installed by Homebrew.
final class OnlineMediaService {
    struct ToolStatus {
        let available: Bool
        let version: String
        let managed: Bool
        let origin: String

        var dictionary: [String: Any] {
            ["available": available, "version": version, "managed": managed, "origin": origin]
        }
    }

    struct Download {
        let fileURL: URL
        let info: [String: Any]
        let thumbnailURL: URL?
        let subtitleURL: URL?
    }

    struct Progress {
        let fraction: Double
        let message: String
    }

    private let fileManager = FileManager.default
    private let toolsDirectory: URL
    private let processLock = NSLock()
    private var activeProcesses: [String: Process] = [:]
    private var cancelledOperations: Set<String> = []

    init(applicationSupportDirectory: URL) {
        toolsDirectory = applicationSupportDirectory.appendingPathComponent("Tools", isDirectory: true)
    }

    var managedToolURL: URL { toolsDirectory.appendingPathComponent("yt-dlp") }

    // MARK: - Engine

    func toolURL() -> (url: URL, managed: Bool, origin: String)? {
        let candidates: [(URL, Bool, String)] = [
            (managedToolURL, true, "managed"),
            (URL(fileURLWithPath: "/opt/homebrew/bin/yt-dlp"), false, "homebrew"),
            (URL(fileURLWithPath: "/usr/local/bin/yt-dlp"), false, "homebrew"),
            (URL(fileURLWithPath: "/opt/local/bin/yt-dlp"), false, "system"),
        ]
        for (candidate, managed, origin) in candidates {
            let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
            guard
                let values = try? resolved.resourceValues(forKeys: [.isRegularFileKey]),
                values.isRegularFile == true,
                fileManager.isExecutableFile(atPath: resolved.path)
            else { continue }
            return (resolved, managed, origin)
        }
        return nil
    }

    func status() -> ToolStatus {
        guard let tool = toolURL() else {
            return ToolStatus(available: false, version: "", managed: false, origin: "")
        }
        return ToolStatus(available: true, version: version(of: tool.url) ?? "", managed: tool.managed, origin: tool.origin)
    }

    private func version(of executable: URL) -> String? {
        var output = Data()
        let status = try? BoundedProcessRunner.streamStandardOutput(
            executableURL: executable,
            arguments: ["--ignore-config", "--version"],
            timeout: 30
        ) { chunk in
            if output.count < 4_096 { output.append(chunk) }
        }
        guard status == 0 else { return nil }
        let value = String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : String(value.prefix(40))
    }

    /// Installs (or replaces) the managed yt-dlp with the latest release, after
    /// checking it against the release's published SHA-256.
    func installLatestTool() throws -> ToolStatus {
        try fileManager.createDirectory(at: toolsDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let sumsData = try Self.fetch(OnlineMediaPolicy.toolChecksumsURL, maximumBytes: 256 * 1_024)
        guard let expected = OnlineMediaPolicy.expectedChecksum(in: String(decoding: sumsData, as: UTF8.self)) else {
            throw OnlineMediaError.toolDownloadFailed("empreinte introuvable dans la publication.")
        }
        let binary = try Self.fetch(OnlineMediaPolicy.toolDownloadURL, maximumBytes: OnlineMediaPolicy.toolMaximumBytes)
        let digest = SHA256.hash(data: binary).map { String(format: "%02x", $0) }.joined()
        guard digest == expected else { throw OnlineMediaError.toolChecksumMismatch }

        let temporary = toolsDirectory.appendingPathComponent("yt-dlp-\(UUID().uuidString).download")
        defer { try? fileManager.removeItem(at: temporary) }
        try binary.write(to: temporary, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: temporary.path)
        guard version(of: temporary) != nil else {
            throw OnlineMediaError.toolDownloadFailed("le moteur téléchargé ne démarre pas sur ce Mac.")
        }
        if fileManager.fileExists(atPath: managedToolURL.path) {
            _ = try fileManager.replaceItemAt(managedToolURL, withItemAt: temporary)
        } else {
            try fileManager.moveItem(at: temporary, to: managedToolURL)
        }
        return status()
    }

    private static func fetch(_ url: URL, maximumBytes: Int) throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
        request.setValue("Cinecrique", forHTTPHeaderField: "User-Agent")
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Data, Error> = .failure(OnlineMediaError.toolDownloadFailed("délai dépassé."))
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error {
                result = .failure(OnlineMediaError.toolDownloadFailed(error.localizedDescription))
                return
            }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                result = .failure(OnlineMediaError.toolDownloadFailed("réponse inattendue du serveur."))
                return
            }
            guard data.count <= maximumBytes else {
                result = .failure(OnlineMediaError.toolDownloadFailed("fichier trop volumineux."))
                return
            }
            result = .success(data)
        }
        task.resume()
        if semaphore.wait(timeout: .now() + 300) == .timedOut {
            task.cancel()
            throw OnlineMediaError.toolDownloadFailed("délai dépassé.")
        }
        return try result.get()
    }

    // MARK: - Download

    static func defaultOutputDirectory() throws -> URL {
        let movies = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Movies", isDirectory: true)
        let directory = movies.appendingPathComponent("Cinécrique", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.standardizedFileURL
    }

    func download(
        request: OnlineMediaPolicy.Request,
        operationID: String,
        progress: @escaping (Progress) -> Void
    ) throws -> Download {
        defer { finish(operationID: operationID) }
        guard let tool = toolURL() else { throw OnlineMediaError.toolUnavailable }
        let outputDirectory = try Self.defaultOutputDirectory()
        let ffmpegDirectory = MediaToolLocator.executableURL(named: "ffmpeg")?.deletingLastPathComponent()
        let arguments = OnlineMediaPolicy.arguments(
            request: request,
            outputDirectory: outputDirectory,
            ffmpegDirectory: ffmpegDirectory
        )

        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = tool.url
        process.arguments = arguments
        process.currentDirectoryURL = outputDirectory
        process.standardOutput = output
        process.standardError = errors
        var environment = ProcessInfo.processInfo.environment
        environment["PYTHONIOENCODING"] = "utf-8"
        environment["LC_ALL"] = "en_US.UTF-8"
        process.environment = environment

        try register(process: process, operationID: operationID)
        defer { unregister(operationID: operationID) }
        do {
            try process.run()
        } catch {
            throw OnlineMediaError.toolUnavailable
        }

        let state = OutputState()
        let readers = DispatchGroup()
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            defer { readers.leave() }
            Self.readLines(output.fileHandleForReading) { line in
                if let file = OnlineMediaPolicy.parseOutputFile(line, outputDirectory: outputDirectory) {
                    state.setFile(file)
                } else if let value = OnlineMediaPolicy.parseProgress(line) {
                    progress(Self.progress(from: value, phase: state.nextPhase(for: value)))
                } else if line.contains("[Merger]") || line.contains("[VideoRemuxer]") {
                    progress(Progress(fraction: 0.97, message: "Assemblage de l’image et du son"))
                }
            }
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            defer { readers.leave() }
            Self.readLines(errors.fileHandleForReading) { line in
                if let value = OnlineMediaPolicy.parseProgress(line) {
                    progress(Self.progress(from: value, phase: state.nextPhase(for: value)))
                } else {
                    state.appendError(line)
                }
            }
        }

        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            process.waitUntilExit()
            finished.signal()
        }
        if finished.wait(timeout: .now() + OnlineMediaPolicy.downloadTimeout) == .timedOut {
            _ = cancel(operationID: operationID)
            finished.wait()
        }
        readers.wait()

        if isCancelled(operationID) { throw OnlineMediaError.cancelled }
        // With --ignore-errors a secondary failure (subtitles, thumbnail) gives a
        // non-zero status although the video is complete: the file decides.
        guard
            let fileURL = state.file,
            let values = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
            values.isRegularFile == true,
            (values.fileSize ?? 0) > 0
        else {
            if process.terminationStatus != 0 {
                throw OnlineMediaError.downloadFailed(OnlineMediaPolicy.readableError(from: state.errorText))
            }
            throw OnlineMediaError.outputMissing
        }

        let base = fileURL.deletingPathExtension()
        let infoURL = base.appendingPathExtension("info.json")
        let info = Self.readInfo(at: infoURL)
        try? fileManager.removeItem(at: infoURL)
        let thumbnail = base.appendingPathExtension("jpg")
        let subtitle = Self.subtitleFile(near: base, in: outputDirectory)
        return Download(
            fileURL: fileURL,
            info: info,
            thumbnailURL: fileManager.fileExists(atPath: thumbnail.path) ? thumbnail : nil,
            subtitleURL: subtitle
        )
    }

    private static func progress(from value: OnlineMediaPolicy.Progress, phase: Int) -> Progress {
        let fraction = value.fraction ?? 0
        // The video stream comes first, then the audio stream: keep the bar moving forward.
        let overall = phase == 0 ? fraction * 0.85 : 0.85 + fraction * 0.1
        var message = phase == 0 ? "Téléchargement de la vidéo" : "Téléchargement du son"
        if let total = value.totalBytes {
            message += " · \(ByteCountFormatter.string(fromByteCount: Int64(value.downloadedBytes), countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: Int64(total), countStyle: .file))"
        }
        if let speed = value.bytesPerSecond {
            message += " · \(ByteCountFormatter.string(fromByteCount: Int64(speed), countStyle: .file))/s"
        }
        return Progress(fraction: min(max(overall, 0), 0.96), message: message)
    }

    private static func readInfo(at url: URL) -> [String: Any] {
        guard
            let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
            (values.fileSize ?? 0) <= 32 * 1_024 * 1_024,
            let data = try? Data(contentsOf: url),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        var info: [String: Any] = [:]
        for key in ["title", "uploader", "channel", "extractor_key", "upload_date", "webpage_url", "id"] {
            if let value = json[key] as? String { info[key] = String(value.prefix(2_000)) }
        }
        if let duration = json["duration"] as? NSNumber { info["duration"] = duration.doubleValue }
        return info
    }

    private static func subtitleFile(near base: URL, in directory: URL) -> URL? {
        let prefix = base.lastPathComponent + "."
        guard let items = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
            return nil
        }
        let candidates = items.filter { $0.lastPathComponent.hasPrefix(prefix) && $0.pathExtension.lowercased() == "srt" }
        return candidates.first(where: { $0.lastPathComponent.contains(".fr") }) ?? candidates.first
    }

    private static func readLines(_ handle: FileHandle, onLine: (String) -> Void) {
        var buffer = Data()
        while true {
            let chunk = handle.availableData
            if chunk.isEmpty { break }
            buffer.append(chunk)
            if buffer.count > 4 * 1_024 * 1_024 { buffer.removeAll(keepingCapacity: true) }
            while let newline = buffer.firstIndex(where: { $0 == 0x0A || $0 == 0x0D }) {
                let lineData = buffer[buffer.startIndex..<newline]
                buffer.removeSubrange(buffer.startIndex...newline)
                let line = String(decoding: lineData, as: UTF8.self)
                if !line.isEmpty { onLine(line) }
            }
        }
        if !buffer.isEmpty { onLine(String(decoding: buffer, as: UTF8.self)) }
    }

    // MARK: - Cancellation

    func cancel(operationID: String) -> Bool {
        processLock.lock()
        cancelledOperations.insert(operationID)
        let process = activeProcesses[operationID]
        processLock.unlock()
        guard let process else { return false }
        if process.isRunning {
            process.interrupt()
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 2) {
                if process.isRunning { process.terminate() }
            }
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) {
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
        }
        return true
    }

    func finish(operationID: String) {
        processLock.lock()
        activeProcesses.removeValue(forKey: operationID)
        cancelledOperations.remove(operationID)
        processLock.unlock()
    }

    private func register(process: Process, operationID: String) throws {
        processLock.lock()
        defer { processLock.unlock() }
        guard !cancelledOperations.contains(operationID) else { throw OnlineMediaError.cancelled }
        activeProcesses[operationID] = process
    }

    private func unregister(operationID: String) {
        processLock.lock()
        activeProcesses.removeValue(forKey: operationID)
        processLock.unlock()
    }

    private func isCancelled(_ operationID: String) -> Bool {
        processLock.lock()
        defer { processLock.unlock() }
        return cancelledOperations.contains(operationID)
    }

    private final class OutputState: @unchecked Sendable {
        private let lock = NSLock()
        private var storedFile: URL?
        private var errorLines: [String] = []
        private var phase = 0
        private var lastFraction = 0.0

        var file: URL? {
            lock.lock()
            defer { lock.unlock() }
            return storedFile
        }

        var errorText: String {
            lock.lock()
            defer { lock.unlock() }
            return errorLines.joined(separator: "\n")
        }

        func setFile(_ url: URL) {
            lock.lock()
            storedFile = url
            lock.unlock()
        }

        func appendError(_ line: String) {
            lock.lock()
            errorLines.append(String(line.prefix(2_000)))
            if errorLines.count > 60 { errorLines.removeFirst(errorLines.count - 60) }
            lock.unlock()
        }

        func nextPhase(for progress: OnlineMediaPolicy.Progress) -> Int {
            lock.lock()
            defer { lock.unlock() }
            let fraction = progress.fraction ?? 0
            if lastFraction > 0.9 && fraction < 0.2 { phase = min(phase + 1, 1) }
            lastFraction = fraction
            return phase
        }
    }
}
