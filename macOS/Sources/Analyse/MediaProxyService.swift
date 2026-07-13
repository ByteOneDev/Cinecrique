import CryptoKit
import Darwin
import Foundation
import AnalyseCore

final class MediaProxyService {
    struct ExtractedSubtitle {
        let name: String
        let content: String
    }

    struct PreparedMedia {
        let playbackURL: URL
        let proxyUsed: Bool
        let mode: MediaProxyMode?
        let reused: Bool
        let subtitle: ExtractedSubtitle?
    }

    struct Progress {
        let stage: String
        let fraction: Double
        let message: String
        let cancellable: Bool
    }

    private let fileManager: FileManager
    private let cacheRoot: URL
    private let processLock = NSLock()
    private var activeProcesses: [String: Process] = [:]
    private var cancelledOperations: Set<String> = []

    init(applicationSupportDirectory: URL, fileManager: FileManager = .default) throws {
        self.fileManager = fileManager
        cacheRoot = applicationSupportDirectory.appendingPathComponent("Media Proxies", isDirectory: true)
        try Self.ensureDirectory(cacheRoot, fileManager: fileManager)
    }

    var available: Bool {
        MediaToolLocator.executableURL(named: "ffmpeg") != nil && FFprobeService.executableURL != nil
    }

    func prepare(
        originalURL: URL,
        metadata: [String: Any],
        operationID: String,
        forceProxy: Bool = false,
        progress: @escaping (Progress) -> Void
    ) throws -> PreparedMedia {
        defer { finish(operationID: operationID) }
        try throwIfCancelled(operationID)
        progress(Progress(stage: "inspection", fraction: 0.02, message: "Analyse du conteneur et des pistes", cancellable: true))
        let description = Self.mediaDescription(metadata)
        guard !description.videoCodec.isEmpty else { throw ProxyError.missingVideoTrack }
        let decision = MediaProxyPolicy.decision(
            fileExtension: originalURL.pathExtension,
            videoCodec: description.videoCodec,
            audioCodecs: description.audioCodecs,
            forceProxy: forceProxy
        )
        guard decision.requiresProxy else {
            return PreparedMedia(playbackURL: originalURL, proxyUsed: false, mode: nil, reused: false, subtitle: nil)
        }
        guard let executableURL = MediaToolLocator.executableURL(named: "ffmpeg") else {
            throw ProxyError.ffmpegUnavailable
        }

        let cache = try cacheLocation(for: originalURL)
        if let cached = try cachedPreparation(at: cache, originalURL: originalURL) {
            progress(Progress(stage: "complete", fraction: 1, message: "Proxy compatible restauré", cancellable: false))
            return cached
        }

        try ensureFreeSpace(for: originalURL)
        try Self.ensureDirectory(cache.directory, fileManager: fileManager)
        let temporaryURL = cache.directory.appendingPathComponent("playback-\(UUID().uuidString).mp4")
        defer { try? fileManager.removeItem(at: temporaryURL) }

        let mode = decision.mode ?? .transcodeVideo
        progress(Progress(
            stage: mode.rawValue,
            fraction: 0.05,
            message: Self.message(for: mode),
            cancellable: true
        ))

        let arguments = Self.proxyArguments(
            originalURL: originalURL,
            outputURL: temporaryURL,
            decision: decision,
            description: description
        )
        try runFFmpeg(
            executableURL: executableURL,
            arguments: arguments,
            operationID: operationID,
            duration: description.duration
        ) { fraction in
            progress(Progress(
                stage: mode.rawValue,
                fraction: 0.05 + min(max(fraction, 0), 1) * 0.87,
                message: Self.message(for: mode),
                cancellable: true
            ))
        }
        try throwIfCancelled(operationID)

        progress(Progress(stage: "validation", fraction: 0.94, message: "Validation du proxy local", cancellable: true))
        let outputMetadata = try FFprobeService.inspect(temporaryURL)
        try throwIfCancelled(operationID)
        guard Self.mediaDescription(outputMetadata).videoCodec.isEmpty == false else {
            throw ProxyError.invalidProxy
        }

        if fileManager.fileExists(atPath: cache.playback.path) {
            try fileManager.removeItem(at: cache.playback)
        }
        try fileManager.moveItem(at: temporaryURL, to: cache.playback)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: cache.playback.path)

        let subtitle = try extractSubtitleIfPossible(
            originalURL: originalURL,
            metadata: metadata,
            cache: cache,
            executableURL: executableURL,
            operationID: operationID,
            progress: progress
        )
        try throwIfCancelled(operationID)
        try writeManifest(cache: cache, originalURL: originalURL, mode: mode, hasSubtitle: subtitle != nil)
        progress(Progress(stage: "complete", fraction: 1, message: "Proxy compatible prêt", cancellable: false))
        return PreparedMedia(
            playbackURL: cache.playback,
            proxyUsed: true,
            mode: mode,
            reused: false,
            subtitle: subtitle
        )
    }

    func cachedProxy(for originalURL: URL) -> URL? {
        guard
            let cache = try? cacheLocation(for: originalURL),
            (try? validatedRegularFile(cache.playback)) == true,
            (try? validatedCachedManifest(at: cache)) != nil
        else { return nil }
        return cache.playback
    }

    func removeCachedProxy(for originalURL: URL) throws {
        let cache = try cacheLocation(for: originalURL)
        guard cache.directory.deletingLastPathComponent().standardizedFileURL == cacheRoot.standardizedFileURL else {
            throw ProxyError.unsafeCache
        }
        if fileManager.fileExists(atPath: cache.directory.path) {
            let values = try cache.directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { throw ProxyError.unsafeCache }
            try fileManager.removeItem(at: cache.directory)
        }
    }

    @discardableResult
    func cancel(operationID: String) -> Bool {
        processLock.lock()
        cancelledOperations.insert(operationID)
        let process = activeProcesses[operationID]
        processLock.unlock()
        guard let process else { return true }
        if process.isRunning {
            process.terminate()
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 2) {
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
        }
        return true
    }

    private func cacheLocation(for originalURL: URL) throws -> CacheLocation {
        let values = try originalURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard
            values.isRegularFile == true,
            values.isSymbolicLink != true,
            let fileSize = values.fileSize,
            fileSize >= 0
        else { throw ProxyError.invalidSource }
        let modified = values.contentModificationDate?.timeIntervalSince1970 ?? 0
        let identity = "\(originalURL.standardizedFileURL.path)\u{0}\(fileSize)\u{0}\(modified.bitPattern)"
        let digest = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        let directory = cacheRoot.appendingPathComponent(digest, isDirectory: true)
        return CacheLocation(
            directory: directory,
            playback: directory.appendingPathComponent("playback.mp4"),
            subtitle: directory.appendingPathComponent("subtitles.vtt"),
            manifest: directory.appendingPathComponent("manifest.json"),
            fingerprint: digest
        )
    }

    private func cachedPreparation(at cache: CacheLocation, originalURL: URL) throws -> PreparedMedia? {
        guard try validatedRegularFile(cache.playback) else { return nil }
        guard let manifest = try? validatedCachedManifest(at: cache) else { return nil }
        var subtitle: ExtractedSubtitle?
        if manifest.hasSubtitle,
           try validatedRegularFile(cache.subtitle),
           let content = try? readTextFile(cache.subtitle, maximumBytes: 20 * 1_024 * 1_024) {
            subtitle = ExtractedSubtitle(
                name: "\(originalURL.deletingPathExtension().lastPathComponent).vtt",
                content: content
            )
        }
        return PreparedMedia(
            playbackURL: cache.playback,
            proxyUsed: true,
            mode: manifest.mode,
            reused: true,
            subtitle: subtitle
        )
    }

    private func validatedCachedManifest(at cache: CacheLocation) throws -> CachedManifest {
        guard try validatedRegularFile(cache.manifest) else { throw ProxyError.invalidProxy }
        let values = try cache.manifest.resourceValues(forKeys: [.fileSizeKey])
        guard
            let size = values.fileSize,
            size <= 64 * 1_024,
            let object = try JSONSerialization.jsonObject(with: Data(contentsOf: cache.manifest)) as? [String: Any],
            (object["version"] as? NSNumber)?.intValue == 1,
            object["fingerprint"] as? String == cache.fingerprint,
            let mode = MediaProxyMode(rawValue: object["mode"] as? String ?? "")
        else { throw ProxyError.invalidProxy }
        let hasSubtitle = object["subtitle"] as? String == cache.subtitle.lastPathComponent
        if hasSubtitle, try validatedRegularFile(cache.subtitle) == false { throw ProxyError.invalidProxy }
        return CachedManifest(mode: mode, hasSubtitle: hasSubtitle)
    }

    private func extractSubtitleIfPossible(
        originalURL: URL,
        metadata: [String: Any],
        cache: CacheLocation,
        executableURL: URL,
        operationID: String,
        progress: @escaping (Progress) -> Void
    ) throws -> ExtractedSubtitle? {
        guard let subtitleIndex = Self.firstTextSubtitleIndex(metadata) else {
            try? fileManager.removeItem(at: cache.subtitle)
            return nil
        }
        progress(Progress(stage: "subtitles", fraction: 0.96, message: "Extraction des sous-titres intégrés", cancellable: true))
        try? fileManager.removeItem(at: cache.subtitle)
        do {
            try runFFmpeg(
                executableURL: executableURL,
                arguments: [
                    "-hide_banner", "-nostdin", "-y",
                    "-i", originalURL.path,
                    "-map", "0:\(subtitleIndex)",
                    "-c:s", "webvtt",
                    cache.subtitle.path,
                ],
                operationID: operationID,
                duration: 0,
                onProgress: { _ in }
            )
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: cache.subtitle.path)
            let content = try readTextFile(cache.subtitle, maximumBytes: 20 * 1_024 * 1_024)
            return ExtractedSubtitle(
                name: "\(originalURL.deletingPathExtension().lastPathComponent).vtt",
                content: content
            )
        } catch ProxyError.cancelled {
            throw ProxyError.cancelled
        } catch {
            try? fileManager.removeItem(at: cache.subtitle)
            return nil
        }
    }

    private func runFFmpeg(
        executableURL: URL,
        arguments: [String],
        operationID: String,
        duration: Double,
        onProgress: @escaping (Double) -> Void
    ) throws {
        let process = Process()
        let progressPipe = Pipe()
        let errorPipe = Pipe()
        process.executableURL = executableURL
        process.arguments = ["-progress", "pipe:1", "-nostats"] + arguments
        process.standardOutput = progressPipe
        process.standardError = errorPipe

        try register(process: process, operationID: operationID)
        defer { unregister(operationID: operationID) }

        do {
            try process.run()
        } catch {
            throw ProxyError.launchFailed
        }

        let readers = DispatchGroup()
        let errorBox = DataBox()
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            defer { readers.leave() }
            do {
                errorBox.data = try Self.readCapped(errorPipe.fileHandleForReading, maximumBytes: 2 * 1_024 * 1_024)
            } catch {
                errorBox.error = error
                if process.isRunning { process.terminate() }
            }
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            defer { readers.leave() }
            Self.readProgress(progressPipe.fileHandleForReading, duration: duration, onProgress: onProgress)
        }

        process.waitUntilExit()
        readers.wait()
        if isCancelled(operationID) { throw ProxyError.cancelled }
        if let error = errorBox.error { throw error }
        guard process.terminationStatus == 0 else {
            throw ProxyError.failed(Self.sanitizedError(errorBox.data))
        }
    }

    private func register(process: Process, operationID: String) throws {
        processLock.lock()
        defer { processLock.unlock() }
        guard !cancelledOperations.contains(operationID) else { throw ProxyError.cancelled }
        activeProcesses[operationID] = process
    }

    private func unregister(operationID: String) {
        processLock.lock()
        activeProcesses.removeValue(forKey: operationID)
        processLock.unlock()
    }

    func finish(operationID: String) {
        processLock.lock()
        activeProcesses.removeValue(forKey: operationID)
        cancelledOperations.remove(operationID)
        processLock.unlock()
    }

    private func throwIfCancelled(_ operationID: String) throws {
        if isCancelled(operationID) { throw ProxyError.cancelled }
    }

    private func isCancelled(_ operationID: String) -> Bool {
        processLock.lock()
        defer { processLock.unlock() }
        return cancelledOperations.contains(operationID)
    }

    private func ensureFreeSpace(for sourceURL: URL) throws {
        let sourceValues = try sourceURL.resourceValues(forKeys: [.fileSizeKey])
        guard let fileSize = sourceValues.fileSize else { throw ProxyError.invalidSource }
        let rootValues = try cacheRoot.resourceValues(forKeys: [
            .volumeAvailableCapacityForImportantUsageKey,
            .volumeAvailableCapacityKey,
        ])
        var reportedCapacities: [Int64] = []
        if let value = rootValues.volumeAvailableCapacityForImportantUsage, value > 0 {
            reportedCapacities.append(value)
        }
        if let value = rootValues.volumeAvailableCapacity, value > 0 {
            reportedCapacities.append(Int64(value))
        }
        if
            let attributes = try? fileManager.attributesOfFileSystem(forPath: cacheRoot.path),
            let value = attributes[.systemFreeSize] as? NSNumber,
            value.int64Value > 0
        {
            reportedCapacities.append(value.int64Value)
        }
        let available = reportedCapacities.max() ?? Int64.max
        let sourceBytes = Int64(fileSize)
        let required = max(512 * 1_024 * 1_024, sourceBytes + sourceBytes / 10)
        guard available > required else { throw ProxyError.insufficientSpace }
    }

    private func validatedRegularFile(_ url: URL) throws -> Bool {
        guard fileManager.fileExists(atPath: url.path) else { return false }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        return values.isRegularFile == true && values.isSymbolicLink != true && (values.fileSize ?? 0) > 0
    }

    private func readTextFile(_ url: URL, maximumBytes: Int) throws -> String {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        guard let size = values.fileSize, size <= maximumBytes else { throw ProxyError.invalidProxy }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
    }

    private func writeManifest(cache: CacheLocation, originalURL: URL, mode: MediaProxyMode, hasSubtitle: Bool) throws {
        let object: [String: Any] = [
            "version": 1,
            "fingerprint": cache.fingerprint,
            "original": originalURL.lastPathComponent,
            "mode": mode.rawValue,
            "subtitle": hasSubtitle ? cache.subtitle.lastPathComponent : NSNull(),
            "createdAt": ISO8601DateFormatter().string(from: Date()),
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: cache.manifest, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: cache.manifest.path)
    }

    private static func ensureDirectory(_ url: URL, fileManager: FileManager) throws {
        if fileManager.fileExists(atPath: url.path) {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { throw ProxyError.unsafeCache }
        } else {
            try fileManager.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    private static func mediaDescription(_ metadata: [String: Any]) -> MediaDescription {
        let streams = metadata["streams"] as? [[String: Any]] ?? []
        let video = streams.first { $0["codec_type"] as? String == "video" }
        let audio = streams.filter { $0["codec_type"] as? String == "audio" }
        let format = metadata["format"] as? [String: Any]
        let duration = number(format?["duration"]) ?? number(video?["duration"]) ?? 0
        let frameRate = rational(video?["avg_frame_rate"] as? String)
            ?? rational(video?["r_frame_rate"] as? String)
            ?? 24
        return MediaDescription(
            videoCodec: (video?["codec_name"] as? String ?? "").lowercased(),
            audioCodecs: audio.compactMap { ($0["codec_name"] as? String)?.lowercased() },
            duration: duration,
            width: Int(number(video?["width"]) ?? 1_920),
            height: Int(number(video?["height"]) ?? 1_080),
            frameRate: frameRate
        )
    }

    private static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private static func rational(_ value: String?) -> Double? {
        guard let value, !value.isEmpty, value != "0/0" else { return nil }
        let pieces = value.split(separator: "/").compactMap { Double($0) }
        if pieces.count == 2, pieces[1] != 0 { return pieces[0] / pieces[1] }
        return pieces.first
    }

    private static func proxyArguments(
        originalURL: URL,
        outputURL: URL,
        decision: MediaProxyDecision,
        description: MediaDescription
    ) -> [String] {
        var arguments = [
            "-hide_banner", "-nostdin", "-y",
            "-i", originalURL.path,
            "-map", "0:v:0",
            "-map", "0:a?",
            "-map_metadata", "0",
            "-map_chapters", "0",
            "-sn", "-dn",
        ]
        if decision.copyVideo {
            arguments += ["-c:v", "copy"]
            if description.videoCodec == "hevc" { arguments += ["-tag:v", "hvc1"] }
        } else {
            let pixelsPerSecond = Double(max(description.width, 1) * max(description.height, 1)) * max(description.frameRate, 1)
            let bitrate = Int(min(max(pixelsPerSecond * 0.18, 8_000_000), 80_000_000))
            arguments += [
                "-c:v", "h264_videotoolbox",
                "-allow_sw", "1",
                "-tag:v", "avc1",
                "-pix_fmt", "yuv420p",
                "-b:v", String(bitrate),
                "-maxrate", String(min(bitrate * 2, 120_000_000)),
                "-bufsize", String(min(bitrate * 2, 120_000_000)),
                "-fps_mode", "passthrough",
            ]
        }
        if decision.copyAudio {
            arguments += ["-c:a", "copy"]
        } else {
            arguments += ["-c:a", "aac", "-b:a", "256k"]
        }
        arguments += ["-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputURL.path]
        return arguments
    }

    private static func firstTextSubtitleIndex(_ metadata: [String: Any]) -> Int? {
        let textCodecs: Set<String> = ["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]
        let streams = metadata["streams"] as? [[String: Any]] ?? []
        for stream in streams where stream["codec_type"] as? String == "subtitle" {
            guard
                let codec = (stream["codec_name"] as? String)?.lowercased(),
                textCodecs.contains(codec),
                let index = number(stream["index"]).map(Int.init)
            else { continue }
            return index
        }
        return nil
    }

    private static func message(for mode: MediaProxyMode) -> String {
        switch mode {
        case .remux: return "Adaptation du conteneur sans perte"
        case .transcodeAudio: return "Conversion de la piste audio, image inchangée"
        case .transcodeVideo: return "Création d’un proxy de lecture compatible"
        }
    }

    private static func readProgress(_ handle: FileHandle, duration: Double, onProgress: @escaping (Double) -> Void) {
        var pending = ""
        var lastProgress = -1.0
        while true {
            let data = handle.readData(ofLength: 16 * 1_024)
            if data.isEmpty { break }
            pending += String(decoding: data, as: UTF8.self)
            while let newline = pending.firstIndex(of: "\n") {
                let line = String(pending[..<newline]).trimmingCharacters(in: .whitespacesAndNewlines)
                pending.removeSubrange(...newline)
                let pieces = line.split(separator: "=", maxSplits: 1).map(String.init)
                guard pieces.count == 2 else { continue }
                if pieces[0] == "progress", pieces[1] == "end" {
                    onProgress(1)
                    continue
                }
                guard duration > 0, ["out_time_us", "out_time_ms"].contains(pieces[0]), let raw = Double(pieces[1]) else { continue }
                let fraction = min(max(raw / 1_000_000 / duration, 0), 1)
                if fraction - lastProgress >= 0.01 {
                    lastProgress = fraction
                    onProgress(fraction)
                }
            }
            if pending.utf8.count > 64 * 1_024 { pending = String(pending.suffix(4_096)) }
        }
    }

    private static func readCapped(_ handle: FileHandle, maximumBytes: Int) throws -> Data {
        var data = Data()
        while true {
            let chunk = handle.readData(ofLength: 64 * 1_024)
            if chunk.isEmpty { break }
            guard chunk.count <= maximumBytes, data.count <= maximumBytes - chunk.count else {
                throw ProxyError.outputTooLarge
            }
            data.append(chunk)
        }
        return data
    }

    private static func sanitizedError(_ data: Data?) -> String {
        guard let data else { return "La création du proxy a échoué." }
        let raw = String(data: data, encoding: .utf8) ?? "La création du proxy a échoué."
        let lines = raw.split(whereSeparator: { $0.isNewline }).suffix(6)
        return String(lines.joined(separator: "\n").prefix(2_000))
    }

    private struct CacheLocation {
        let directory: URL
        let playback: URL
        let subtitle: URL
        let manifest: URL
        let fingerprint: String
    }

    private struct CachedManifest {
        let mode: MediaProxyMode
        let hasSubtitle: Bool
    }

    private struct MediaDescription {
        let videoCodec: String
        let audioCodecs: [String]
        let duration: Double
        let width: Int
        let height: Int
        let frameRate: Double
    }

    private final class DataBox: @unchecked Sendable {
        private let lock = NSLock()
        private var storedData: Data?
        private var storedError: Error?

        var data: Data? {
            get { lock.withLock { storedData } }
            set { lock.withLock { storedData = newValue } }
        }

        var error: Error? {
            get { lock.withLock { storedError } }
            set { lock.withLock { storedError = newValue } }
        }
    }

    enum ProxyError: LocalizedError {
        case invalidSource
        case unsafeCache
        case missingVideoTrack
        case ffmpegUnavailable
        case insufficientSpace
        case launchFailed
        case invalidProxy
        case outputTooLarge
        case failed(String)
        case cancelled

        var errorDescription: String? {
            switch self {
            case .invalidSource: return "Le fichier vidéo original est invalide ou inaccessible."
            case .unsafeCache: return "Le dossier de proxy local n’est pas sûr."
            case .missingVideoTrack: return "Aucune piste vidéo exploitable n’a été trouvée."
            case .ffmpegUnavailable: return "Le moteur média FFmpeg de Cinécrique est indisponible."
            case .insufficientSpace: return "L’espace disque disponible est insuffisant pour créer le proxy local."
            case .launchFailed: return "Le moteur média local n’a pas pu démarrer."
            case .invalidProxy: return "Le proxy créé est incomplet ou illisible."
            case .outputTooLarge: return "Le diagnostic du moteur média dépasse la limite autorisée."
            case .failed(let message): return message.isEmpty ? "La création du proxy a échoué." : message
            case .cancelled: return "La préparation du média a été annulée."
            }
        }
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}
