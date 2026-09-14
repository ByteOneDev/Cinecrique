import AppKit
import AVFoundation
import Darwin
import Foundation
import AnalyseCore

/// Cuts video extracts and still frames from a local media file. Moving
/// extracts go through the bundled FFmpeg; still frames stay on AVFoundation so
/// a single picture never spawns a process.
final class ClipExportService {
    struct Progress {
        let stage: String
        let fraction: Double
        let message: String
        let cancellable: Bool
        let index: Int
        let total: Int
    }

    struct MediaProfile {
        let size: ClipFrameSize
        let rotationDegrees: Int
        let frameRate: Double
        let duration: Double
        let videoCodec: String
        let audioCodecs: [String]
    }

    private let fileManager: FileManager
    private let processLock = NSLock()
    private var activeProcesses: [String: Process] = [:]
    private var cancelledOperations: Set<String> = []

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    var available: Bool {
        MediaToolLocator.executableURL(named: "ffmpeg") != nil
    }

    // MARK: - Media inspection

    static func profile(from metadata: [String: Any]) throws -> MediaProfile {
        let streams = metadata["streams"] as? [[String: Any]] ?? []
        guard let video = streams.first(where: { $0["codec_type"] as? String == "video" }) else {
            throw ClipExportError.missingVideoTrack
        }
        let audio = streams.filter { $0["codec_type"] as? String == "audio" }
        let format = metadata["format"] as? [String: Any]
        let width = Int(number(video["width"]) ?? 0)
        let height = Int(number(video["height"]) ?? 0)
        guard width > 0, height > 0 else { throw ClipExportError.missingVideoTrack }
        return MediaProfile(
            size: ClipFrameSize(width: width, height: height),
            rotationDegrees: rotation(of: video),
            frameRate: rational(video["avg_frame_rate"] as? String)
                ?? rational(video["r_frame_rate"] as? String)
                ?? 25,
            duration: number(format?["duration"]) ?? number(video["duration"]) ?? 0,
            videoCodec: (video["codec_name"] as? String ?? "").lowercased(),
            audioCodecs: audio.compactMap { ($0["codec_name"] as? String)?.lowercased() }
        )
    }

    // MARK: - Moving extracts

    func exportClip(
        request: ClipRequest,
        sourceURL: URL,
        profile: MediaProfile,
        destination: URL,
        operationID: String,
        progress: @escaping (Progress) -> Void
    ) throws {
        guard !request.format.isStillImage else { throw ClipExportError.unsupportedFormat }
        guard let executableURL = MediaToolLocator.executableURL(named: "ffmpeg") else {
            throw ClipExportError.ffmpegUnavailable
        }
        try throwIfCancelled(operationID)

        let duration = try ClipExportPolicy.validatedDuration(
            start: request.start,
            end: request.end,
            format: request.format,
            mediaDuration: profile.duration
        )
        let size = ClipExportPolicy.outputSize(
            sourceWidth: profile.size.width,
            sourceHeight: profile.size.height,
            rotationDegrees: profile.rotationDegrees,
            maxHeight: request.maxHeight,
            format: request.format
        )
        let sourceSize = ClipExportPolicy.outputSize(
            sourceWidth: profile.size.width,
            sourceHeight: profile.size.height,
            rotationDegrees: profile.rotationDegrees,
            maxHeight: 0,
            format: .mp4
        )
        let watermark = request.watermark.flatMap { $0.isEnabled ? $0 : nil }
        let mode = ClipExportPolicy.resolvedMode(
            requested: request.mode,
            format: request.format,
            containerExtension: sourceURL.pathExtension,
            videoCodec: profile.videoCodec,
            audioCodecs: profile.audioCodecs,
            includeAudio: request.includeAudio,
            watermarked: watermark != nil,
            scaled: size != sourceSize
        )

        let workingRoot = fileManager.temporaryDirectory
            .appendingPathComponent("Cinecrique-Clip-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(
            at: workingRoot,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        defer { try? fileManager.removeItem(at: workingRoot) }

        var watermarkPath: String?
        if let watermark {
            let imageURL = workingRoot.appendingPathComponent("watermark.png")
            let data = try WatermarkRenderer.pngData(watermark: watermark, frame: size)
            try data.write(to: imageURL, options: .atomic)
            watermarkPath = imageURL.path
        }

        let temporaryOutput = workingRoot.appendingPathComponent("extract.\(request.format.fileExtension)")
        try ensureSpace(for: request, duration: duration, size: size, at: destination)

        let arguments = ClipExportPolicy.arguments(
            inputPath: sourceURL.path,
            watermarkImagePath: watermarkPath,
            outputPath: temporaryOutput.path,
            request: request,
            duration: duration,
            size: size,
            sourceSize: sourceSize,
            sourceFrameRate: profile.frameRate,
            mode: mode
        )

        progress(Progress(
            stage: mode == .copy ? "copy" : "encode",
            fraction: 0.02,
            message: mode == .copy ? "Copie directe de l’extrait" : "Encodage de l’extrait",
            cancellable: true,
            index: 0,
            total: 1
        ))

        try runFFmpeg(
            executableURL: executableURL,
            arguments: arguments,
            operationID: operationID,
            duration: duration
        ) { fraction in
            progress(Progress(
                stage: mode == .copy ? "copy" : "encode",
                fraction: 0.02 + min(max(fraction, 0), 1) * 0.9,
                message: mode == .copy ? "Copie directe de l’extrait" : "Encodage de l’extrait",
                cancellable: true,
                index: 0,
                total: 1
            ))
        }
        try throwIfCancelled(operationID)

        let values = try temporaryOutput.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
            throw ClipExportError.emptyOutput
        }

        progress(Progress(
            stage: "writing",
            fraction: 0.96,
            message: "Écriture du fichier",
            cancellable: false,
            index: 0,
            total: 1
        ))
        try moveIntoPlace(temporaryOutput, destination: destination)
    }

    // MARK: - Still frames

    static func renderStill(request: ClipRequest, mediaURL: URL) throws -> Data {
        guard request.format.isStillImage else { throw ClipExportError.unsupportedFormat }
        let asset = AVURLAsset(url: mediaURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero

        let requested = CMTime(seconds: max(0, request.start), preferredTimescale: 60_000)
        var actual = CMTime.invalid
        let image = try generator.copyCGImage(at: requested, actualTime: &actual)
        let nominal = asset.tracks(withMediaType: .video).first?.nominalFrameRate ?? 0
        try FrameAccuracyPolicy.validate(
            requestedSeconds: requested.seconds,
            actualSeconds: actual.seconds,
            frameRate: nominal > 0 ? Double(nominal) : 24
        )

        let size = NSSize(width: image.width, height: image.height)
        let canvas = NSImage(size: size)
        canvas.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        NSImage(cgImage: image, size: size).draw(in: NSRect(origin: .zero, size: size))
        if let watermark = request.watermark, watermark.isEnabled {
            WatermarkRenderer.draw(
                watermark: watermark,
                frame: ClipFrameSize(width: image.width, height: image.height)
            )
        }
        canvas.unlockFocus()

        guard let tiff = canvas.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else {
            throw ClipExportError.emptyOutput
        }
        let data = request.format == .png
            ? bitmap.representation(using: .png, properties: [:])
            : bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.92])
        guard let data, !data.isEmpty else { throw ClipExportError.emptyOutput }
        return data
    }

    func writeStill(request: ClipRequest, mediaURL: URL, destination: URL) throws {
        let data = try Self.renderStill(request: request, mediaURL: mediaURL)
        try StorageCapacityPolicy.ensureSpace(
            at: destination.deletingLastPathComponent(),
            payloadBytes: Int64(data.count),
            fileManager: fileManager
        )
        try data.write(to: destination, options: .atomic)
    }

    // MARK: - Cancellation

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

    func finish(operationID: String) {
        processLock.lock()
        activeProcesses.removeValue(forKey: operationID)
        cancelledOperations.remove(operationID)
        processLock.unlock()
    }

    func isCancelled(_ operationID: String) -> Bool {
        processLock.lock()
        defer { processLock.unlock() }
        return cancelledOperations.contains(operationID)
    }

    func throwIfCancelled(_ operationID: String) throws {
        if isCancelled(operationID) { throw ClipExportError.cancelled }
    }

    // MARK: - Private helpers

    private func ensureSpace(
        for request: ClipRequest,
        duration: Double,
        size: ClipFrameSize,
        at destination: URL
    ) throws {
        let bitrate = ClipExportPolicy.videoBitrate(size: size, frameRate: 30, quality: request.quality)
        let estimate = Int64((Double(bitrate) / 8 * max(duration, 1)).rounded()) * 2
        do {
            try StorageCapacityPolicy.ensureSpace(
                at: destination.deletingLastPathComponent(),
                payloadBytes: max(estimate, 8 * 1_024 * 1_024),
                fileManager: fileManager
            )
        } catch {
            throw ClipExportError.insufficientSpace
        }
    }

    private func moveIntoPlace(_ temporary: URL, destination: URL) throws {
        let sibling = destination
            .deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        do {
            try fileManager.copyItem(at: temporary, to: sibling)
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: sibling.path)
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(
                    destination,
                    withItemAt: sibling,
                    backupItemName: nil,
                    options: [.usingNewMetadataOnly]
                )
            } else {
                try fileManager.moveItem(at: sibling, to: destination)
            }
        } catch {
            try? fileManager.removeItem(at: sibling)
            throw error
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
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = progressPipe
        process.standardError = errorPipe

        processLock.lock()
        if cancelledOperations.contains(operationID) {
            processLock.unlock()
            throw ClipExportError.cancelled
        }
        activeProcesses[operationID] = process
        processLock.unlock()
        defer {
            processLock.lock()
            activeProcesses.removeValue(forKey: operationID)
            processLock.unlock()
        }

        do {
            try process.run()
        } catch {
            throw ClipExportError.launchFailed
        }

        let readers = DispatchGroup()
        let errorBox = DiagnosticBox()
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            defer { readers.leave() }
            errorBox.data = Self.readCapped(errorPipe.fileHandleForReading, maximumBytes: 512 * 1_024)
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            defer { readers.leave() }
            Self.readProgress(progressPipe.fileHandleForReading, duration: duration, onProgress: onProgress)
        }

        process.waitUntilExit()
        readers.wait()
        if isCancelled(operationID) { throw ClipExportError.cancelled }
        guard process.terminationStatus == 0 else {
            throw ClipExportError.failed(Self.sanitizedError(errorBox.data))
        }
    }

    private static func readCapped(_ handle: FileHandle, maximumBytes: Int) -> Data {
        var data = Data()
        while true {
            let chunk = handle.readData(ofLength: 64 * 1_024)
            if chunk.isEmpty { break }
            if data.count < maximumBytes {
                data.append(chunk.prefix(maximumBytes - data.count))
            }
        }
        return data
    }

    private static func readProgress(
        _ handle: FileHandle,
        duration: Double,
        onProgress: @escaping (Double) -> Void
    ) {
        var pending = ""
        var last = -1.0
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
                guard duration > 0, ["out_time_us", "out_time_ms"].contains(pieces[0]), let raw = Double(pieces[1]) else {
                    continue
                }
                let fraction = min(max(raw / 1_000_000 / duration, 0), 1)
                if fraction - last >= 0.01 {
                    last = fraction
                    onProgress(fraction)
                }
            }
            if pending.utf8.count > 64 * 1_024 { pending = String(pending.suffix(4_096)) }
        }
    }

    private static func sanitizedError(_ data: Data?) -> String {
        guard let data, let raw = String(data: data, encoding: .utf8) else {
            return "L’export de l’extrait a échoué."
        }
        let lines = raw.split(whereSeparator: { $0.isNewline }).suffix(6)
        let message = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? "L’export de l’extrait a échoué." : String(message.prefix(1_000))
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

    private static func rotation(of stream: [String: Any]) -> Int {
        if let tags = stream["tags"] as? [String: Any], let raw = number(tags["rotate"]) {
            return Int(raw)
        }
        let sideData = stream["side_data_list"] as? [[String: Any]] ?? []
        for entry in sideData {
            if let raw = number(entry["rotation"]) { return Int(raw) }
        }
        return 0
    }

    private final class DiagnosticBox: @unchecked Sendable {
        private let lock = NSLock()
        private var storedData: Data?

        var data: Data? {
            get {
                lock.lock()
                defer { lock.unlock() }
                return storedData
            }
            set {
                lock.lock()
                storedData = newValue
                lock.unlock()
            }
        }
    }
}

/// Draws the burned-in citation. The watermark is always rendered by AppKit and
/// handed to FFmpeg as an image, never as a filter expression.
enum WatermarkRenderer {
    static func pngData(watermark: ClipWatermark, frame: ClipFrameSize) throws -> Data {
        let size = NSSize(width: max(frame.width, 2), height: max(frame.height, 2))
        let canvas = NSImage(size: size)
        canvas.lockFocus()
        NSColor.clear.setFill()
        NSRect(origin: .zero, size: size).fill()
        draw(watermark: watermark, frame: frame)
        canvas.unlockFocus()

        guard
            let tiff = canvas.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
        else { throw ClipExportError.emptyOutput }
        return png
    }

    static func draw(watermark: ClipWatermark, frame: ClipFrameSize) {
        let lines = ClipExportPolicy.sanitizedWatermarkLines(watermark.lines)
        guard !lines.isEmpty else { return }
        let metrics = ClipExportPolicy.watermarkMetrics(frameHeight: frame.height, size: watermark.size)
        let opacity = min(max(watermark.opacity, 0.2), 1)
        let centered = watermark.position == .bottomCenter

        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = centered ? .center : .left
        paragraph.lineBreakMode = .byTruncatingTail

        let attributed = attributedLines(lines, metrics: metrics, opacity: opacity, paragraph: paragraph)
        let maximumWidth = Double(frame.width) - metrics.margin * 2 - metrics.padding * 2
        let measured = attributed.map { $0.size() }
        let blockWidth = min(measured.map(\.width).max() ?? 0, maximumWidth)
        let blockHeight = measured.reduce(0) { $0 + $1.height } + metrics.lineSpacing * Double(max(0, lines.count - 1))

        let plateWidth = blockWidth + metrics.padding * 2
        let plateHeight = blockHeight + metrics.padding * 1.5
        let origin = plateOrigin(
            position: watermark.position,
            frame: frame,
            plate: NSSize(width: plateWidth, height: plateHeight),
            margin: metrics.margin
        )
        let plate = NSRect(origin: origin, size: NSSize(width: plateWidth, height: plateHeight))

        NSColor(calibratedWhite: 0.02, alpha: 0.46 * opacity).setFill()
        NSBezierPath(roundedRect: plate, xRadius: metrics.cornerRadius, yRadius: metrics.cornerRadius).fill()

        var cursor = plate.maxY - metrics.padding * 0.75
        for (index, line) in attributed.enumerated() {
            let height = measured[index].height
            cursor -= height
            line.draw(in: NSRect(
                x: plate.minX + metrics.padding,
                y: cursor,
                width: plateWidth - metrics.padding * 2,
                height: height
            ))
            cursor -= metrics.lineSpacing
        }
    }

    private static func attributedLines(
        _ lines: [String],
        metrics: WatermarkMetrics,
        opacity: Double,
        paragraph: NSParagraphStyle
    ) -> [NSAttributedString] {
        let shadow = NSShadow()
        shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.7 * opacity)
        shadow.shadowBlurRadius = metrics.fontSize * 0.25
        shadow.shadowOffset = NSSize(width: 0, height: -metrics.fontSize * 0.06)

        return lines.enumerated().map { index, line in
            let font: NSFont
            let color: NSColor
            switch index {
            case 0:
                font = NSFont.systemFont(ofSize: metrics.fontSize, weight: .medium)
                color = NSColor(calibratedWhite: 0.97, alpha: opacity)
            case 1:
                font = NSFont.systemFont(ofSize: metrics.fontSize * 0.82, weight: .semibold)
                color = NSColor(calibratedRed: 0.88, green: 0.65, blue: 0.23, alpha: opacity)
            default:
                font = NSFont.monospacedSystemFont(ofSize: metrics.fontSize * 0.74, weight: .regular)
                color = NSColor(calibratedWhite: 0.82, alpha: opacity * 0.92)
            }
            return NSAttributedString(string: line, attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph,
                .shadow: shadow,
            ])
        }
    }

    private static func plateOrigin(
        position: WatermarkPosition,
        frame: ClipFrameSize,
        plate: NSSize,
        margin: Double
    ) -> NSPoint {
        let width = Double(frame.width)
        let height = Double(frame.height)
        let maximumX = max(margin, width - plate.width - margin)
        let topY = max(margin, height - plate.height - margin)
        switch position {
        case .topLeft:
            return NSPoint(x: margin, y: topY)
        case .topRight:
            return NSPoint(x: maximumX, y: topY)
        case .bottomLeft:
            return NSPoint(x: margin, y: margin)
        case .bottomRight:
            return NSPoint(x: maximumX, y: margin)
        case .bottomCenter:
            return NSPoint(x: max(margin, (width - plate.width) / 2), y: margin)
        }
    }
}
