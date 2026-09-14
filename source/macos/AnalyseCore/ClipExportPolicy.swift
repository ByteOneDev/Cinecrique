import Foundation

public enum ClipKind: String, Equatable, Sendable {
    case clip
    case still
}

public enum ClipFormat: String, Equatable, Sendable {
    case mp4
    case gif
    case png
    case jpeg

    public var fileExtension: String {
        switch self {
        case .mp4: return "mp4"
        case .gif: return "gif"
        case .png: return "png"
        case .jpeg: return "jpg"
        }
    }

    public var isStillImage: Bool {
        self == .png || self == .jpeg
    }
}

public enum ClipQuality: String, Equatable, Sendable {
    case high
    case standard
    case light

    var bitsPerPixel: Double {
        switch self {
        case .high: return 0.12
        case .standard: return 0.075
        case .light: return 0.045
        }
    }
}

public enum ClipMode: String, Equatable, Sendable {
    case accurate
    case copy
}

public enum WatermarkPosition: String, Equatable, Sendable {
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"
    case bottomCenter = "bottom-center"
}

public enum WatermarkSize: String, Equatable, Sendable {
    case small
    case medium
    case large

    var heightRatio: Double {
        switch self {
        case .small: return 0.022
        case .medium: return 0.030
        case .large: return 0.040
        }
    }
}

public struct ClipWatermark: Equatable, Sendable {
    public let lines: [String]
    public let position: WatermarkPosition
    public let size: WatermarkSize
    public let opacity: Double

    public init(lines: [String], position: WatermarkPosition, size: WatermarkSize, opacity: Double) {
        self.lines = lines
        self.position = position
        self.size = size
        self.opacity = opacity
    }

    public var isEnabled: Bool { !lines.isEmpty }
}

public struct ClipRequest: Equatable, Sendable {
    public let kind: ClipKind
    public let start: Double
    public let end: Double
    public let format: ClipFormat
    public let maxHeight: Int
    public let quality: ClipQuality
    public let mode: ClipMode
    public let includeAudio: Bool
    public let frameRate: Int
    public let name: String
    public let watermark: ClipWatermark?

    public init(
        kind: ClipKind,
        start: Double,
        end: Double,
        format: ClipFormat,
        maxHeight: Int,
        quality: ClipQuality,
        mode: ClipMode,
        includeAudio: Bool,
        frameRate: Int,
        name: String,
        watermark: ClipWatermark?
    ) {
        self.kind = kind
        self.start = start
        self.end = end
        self.format = format
        self.maxHeight = maxHeight
        self.quality = quality
        self.mode = mode
        self.includeAudio = includeAudio
        self.frameRate = frameRate
        self.name = name
        self.watermark = watermark
    }

    public var duration: Double { max(0, end - start) }
}

public struct ClipFrameSize: Equatable, Sendable {
    public let width: Int
    public let height: Int

    public init(width: Int, height: Int) {
        self.width = width
        self.height = height
    }
}

public struct WatermarkMetrics: Equatable, Sendable {
    public let fontSize: Double
    public let lineSpacing: Double
    public let margin: Double
    public let padding: Double
    public let cornerRadius: Double

    public init(fontSize: Double, lineSpacing: Double, margin: Double, padding: Double, cornerRadius: Double) {
        self.fontSize = fontSize
        self.lineSpacing = lineSpacing
        self.margin = margin
        self.padding = padding
        self.cornerRadius = cornerRadius
    }
}

/// Shared rules for the extract studio. Everything here is pure so the exact
/// command line handed to FFmpeg, the accepted ranges and the burned-in
/// watermark geometry stay verifiable without touching the file system.
public enum ClipExportPolicy {
    public static let maxClipSeconds: Double = 600
    public static let maxGifSeconds: Double = 30
    public static let minClipSeconds: Double = 0.04
    public static let maxBatchItems = 60
    public static let maxWatermarkLines = 3
    public static let maxWatermarkLineCharacters = 280
    public static let maxGifHeight = 480
    public static let maxOutputHeight = 4_320
    public static let minimumVideoBitrate = 800_000
    public static let maximumVideoBitrate = 80_000_000
    public static let copyableVideoCodecs: Set<String> = ["h264", "hevc"]
    public static let copyableAudioCodecs: Set<String> = ["aac"]
    public static let copyableContainers: Set<String> = ["mp4", "m4v", "mov", "qt", "f4v", "mkv", "webm", "ts", "m2ts", "mts", "avi", "flv"]

    public static func validatedDuration(
        start: Double,
        end: Double,
        format: ClipFormat,
        mediaDuration: Double?
    ) throws -> Double {
        guard start.isFinite, end.isFinite, start >= 0, end >= 0 else {
            throw ClipExportError.invalidRange
        }
        if let mediaDuration, mediaDuration > 0, start >= mediaDuration + 0.5 {
            throw ClipExportError.rangeOutsideMedia
        }
        if format.isStillImage { return 0 }
        let duration = end - start
        guard duration >= minClipSeconds else { throw ClipExportError.invalidRange }
        let limit = format == .gif ? maxGifSeconds : maxClipSeconds
        guard duration <= limit else { throw ClipExportError.rangeTooLong }
        return duration
    }

    public static func sanitizedWatermarkLines(_ lines: [String]) -> [String] {
        Array(
            lines
                .prefix(maxWatermarkLines * 4)
                .map { line in
                    String(
                        String.UnicodeScalarView(
                            line.unicodeScalars.filter { $0 == " " || !CharacterSet.controlCharacters.contains($0) }
                        )
                    )
                    .trimmingCharacters(in: .whitespaces)
                }
                .filter { !$0.isEmpty }
                .map { String($0.prefix(maxWatermarkLineCharacters)) }
                .prefix(maxWatermarkLines)
        )
    }

    public static func sanitizedFileName(_ value: String?, fallback: String, fileExtension: String) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        let stem = URL(fileURLWithPath: value ?? "")
            .deletingPathExtension()
            .lastPathComponent
            .decomposedStringWithCanonicalMapping
        let filtered = String(stem.unicodeScalars.filter { allowed.contains($0) })
            .trimmingCharacters(in: CharacterSet(charactersIn: "._-"))
        let base = filtered.isEmpty ? fallback : String(filtered.prefix(120))
        return "\(base).\(fileExtension)"
    }

    /// A cut can only be copied when nothing touches the picture and both the
    /// source codecs and the container tolerate a straight MP4 remux.
    public static func resolvedMode(
        requested: ClipMode,
        format: ClipFormat,
        containerExtension: String,
        videoCodec: String?,
        audioCodecs: [String],
        includeAudio: Bool,
        watermarked: Bool,
        scaled: Bool
    ) -> ClipMode {
        guard requested == .copy, format == .mp4, !watermarked, !scaled else { return .accurate }
        guard copyableContainers.contains(containerExtension.lowercased()) else { return .accurate }
        guard copyableVideoCodecs.contains((videoCodec ?? "").lowercased()) else { return .accurate }
        guard !includeAudio || audioCodecs.allSatisfy({ copyableAudioCodecs.contains($0.lowercased()) }) else {
            return .accurate
        }
        return .copy
    }

    public static func outputSize(
        sourceWidth: Int,
        sourceHeight: Int,
        rotationDegrees: Int,
        maxHeight: Int,
        format: ClipFormat
    ) -> ClipFrameSize {
        let rotated = abs(rotationDegrees % 180) == 90
        let width = max(2, rotated ? sourceHeight : sourceWidth)
        let height = max(2, rotated ? sourceWidth : sourceHeight)
        var ceiling = maxHeight > 0 ? min(maxHeight, maxOutputHeight) : maxOutputHeight
        if format == .gif { ceiling = min(ceiling, maxGifHeight) }
        let targetHeight = min(height, ceiling)
        let scale = Double(targetHeight) / Double(height)
        let targetWidth = Int((Double(width) * scale).rounded())
        return ClipFrameSize(width: evenValue(targetWidth), height: evenValue(targetHeight))
    }

    public static func videoBitrate(size: ClipFrameSize, frameRate: Double, quality: ClipQuality) -> Int {
        let pixels = Double(max(size.width, 2) * max(size.height, 2))
        let rate = frameRate.isFinite && frameRate > 0 ? min(frameRate, 60) : 25
        let raw = pixels * rate * quality.bitsPerPixel
        guard raw.isFinite else { return minimumVideoBitrate }
        return Int(min(max(raw, Double(minimumVideoBitrate)), Double(maximumVideoBitrate)))
    }

    public static func watermarkMetrics(frameHeight: Int, size: WatermarkSize) -> WatermarkMetrics {
        let height = Double(max(frameHeight, 120))
        let fontSize = max(11, (height * size.heightRatio).rounded())
        return WatermarkMetrics(
            fontSize: fontSize,
            lineSpacing: (fontSize * 0.36).rounded(),
            margin: (height * 0.035).rounded(),
            padding: (fontSize * 0.62).rounded(),
            cornerRadius: (fontSize * 0.28).rounded()
        )
    }

    /// Builds the FFmpeg argument vector. The watermark always reaches FFmpeg as
    /// a pre-rendered image overlaid at the origin, so no caller-supplied text
    /// ever becomes part of a filter expression.
    public static func arguments(
        inputPath: String,
        watermarkImagePath: String?,
        outputPath: String,
        request: ClipRequest,
        duration: Double,
        size: ClipFrameSize,
        sourceSize: ClipFrameSize,
        sourceFrameRate: Double,
        mode: ClipMode
    ) -> [String] {
        var arguments = [
            "-hide_banner", "-nostdin", "-y",
            "-ss", formatSeconds(request.start),
            "-i", inputPath,
            "-t", formatSeconds(duration),
        ]
        if let watermarkImagePath {
            arguments += ["-i", watermarkImagePath]
        }

        if mode == .copy {
            arguments += ["-map", "0:v:0"]
            arguments += request.includeAudio ? ["-map", "0:a:0?"] : ["-an"]
            arguments += ["-sn", "-dn", "-c", "copy"]
            arguments += ["-avoid_negative_ts", "make_zero", "-movflags", "+faststart"]
            arguments.append(outputPath)
            return arguments
        }

        let needsScale = size != sourceSize
        let scaleStep = needsScale ? "scale=\(size.width):\(size.height):flags=lanczos" : "null"

        switch request.format {
        case .gif:
            let rate = request.frameRate > 0 ? request.frameRate : 12
            let base = "[0:v]fps=\(rate),\(scaleStep)[base]"
            let composed = watermarkImagePath == nil
                ? "\(base);[base]split[a][b]"
                : "\(base);[base][1:v]overlay=0:0:format=auto[marked];[marked]split[a][b]"
            let palette = "[a]palettegen=stats_mode=diff[palette];[b][palette]paletteuse=dither=bayer:bayer_scale=3[out]"
            arguments += [
                "-filter_complex", "\(composed);\(palette)",
                "-map", "[out]",
                "-an", "-sn", "-dn",
                "-loop", "0",
            ]
        default:
            if watermarkImagePath == nil {
                arguments += ["-map", "0:v:0"]
                if needsScale { arguments += ["-vf", scaleStep] }
            } else {
                arguments += [
                    "-filter_complex", "[0:v]\(scaleStep)[base];[base][1:v]overlay=0:0:format=auto[out]",
                    "-map", "[out]",
                ]
            }
            arguments += request.includeAudio ? ["-map", "0:a:0?"] : ["-an"]
            arguments += ["-sn", "-dn"]
            let bitrate = videoBitrate(size: size, frameRate: sourceFrameRate, quality: request.quality)
            arguments += [
                "-c:v", "h264_videotoolbox",
                "-allow_sw", "1",
                "-tag:v", "avc1",
                "-pix_fmt", "yuv420p",
                "-b:v", String(bitrate),
                "-maxrate", String(min(bitrate * 2, maximumVideoBitrate)),
                "-bufsize", String(min(bitrate * 2, maximumVideoBitrate)),
            ]
            if request.includeAudio {
                arguments += ["-c:a", "aac", "-b:a", "192k"]
            }
            arguments += ["-movflags", "+faststart"]
        }

        arguments.append(outputPath)
        return arguments
    }

    private static func evenValue(_ value: Int) -> Int {
        let clamped = max(2, min(value, 16_384))
        return clamped % 2 == 0 ? clamped : clamped - 1
    }

    private static func formatSeconds(_ value: Double) -> String {
        let safe = value.isFinite ? max(0, value) : 0
        return String(format: "%.3f", safe)
    }
}

public enum ClipExportError: LocalizedError, Equatable {
    case invalidRange
    case rangeTooLong
    case rangeOutsideMedia
    case tooManyItems
    case unsupportedFormat
    case missingVideoTrack
    case ffmpegUnavailable
    case insufficientSpace
    case launchFailed
    case cancelled
    case emptyOutput
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRange:
            return "Placez un point A et un point B valides avant d’exporter."
        case .rangeTooLong:
            return "Cet extrait dépasse la durée maximale autorisée."
        case .rangeOutsideMedia:
            return "La sélection se situe en dehors du média."
        case .tooManyItems:
            return "La sélection contient trop d’extraits."
        case .unsupportedFormat:
            return "Ce format d’extrait n’est pas pris en charge."
        case .missingVideoTrack:
            return "Aucune piste vidéo exploitable n’a été trouvée."
        case .ffmpegUnavailable:
            return "Le moteur média FFmpeg de Cinécrique est indisponible."
        case .insufficientSpace:
            return "L’espace disque disponible est insuffisant pour cet extrait."
        case .launchFailed:
            return "Le moteur média local n’a pas pu démarrer."
        case .cancelled:
            return "L’export de l’extrait a été annulé."
        case .emptyOutput:
            return "L’extrait généré est vide ou illisible."
        case .failed(let message):
            return message.isEmpty ? "L’export de l’extrait a échoué." : message
        }
    }
}
