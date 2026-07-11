import AppKit
import AVFoundation
import Foundation

enum ExportService {
    struct TextFile {
        let name: String
        let content: String
    }

    struct Frame {
        let name: String
        let time: Double
        let annotations: [[String: Any]]
    }

    static func writeSingleText(_ file: TextFile, to destination: URL) throws {
        guard let data = file.content.data(using: .utf8) else { throw ExportError.invalidText }
        try data.write(to: destination, options: .atomic)
    }

    static func copyVideo(from source: URL, to destination: URL) throws {
        let manager = FileManager.default
        if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
        try manager.copyItem(at: source, to: destination)
    }

    static func writeFrame(_ frame: Frame, mediaURL: URL, to destination: URL) throws {
        let asset = AVURLAsset(url: mediaURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 600)
        let requestedTime = CMTime(seconds: max(0, frame.time), preferredTimescale: 600)
        let image = try generator.copyCGImage(at: requestedTime, actualTime: nil)
        let size = NSSize(width: image.width, height: image.height)
        let composed = NSImage(size: size)

        composed.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        NSImage(cgImage: image, size: size).draw(in: NSRect(origin: .zero, size: size))
        guard let context = NSGraphicsContext.current?.cgContext else {
            composed.unlockFocus()
            throw ExportError.frameRenderingFailed
        }
        draw(frame.annotations, in: context, size: size)
        composed.unlockFocus()

        guard
            let tiff = composed.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
        else { throw ExportError.frameRenderingFailed }
        try png.write(to: destination, options: .atomic)
    }

    static func writeArchive(
        named baseName: String,
        textFiles: [TextFile],
        mediaURL: URL?,
        includeVideo: Bool,
        frames: [Frame],
        to destination: URL
    ) throws {
        let manager = FileManager.default
        let temporaryRoot = manager.temporaryDirectory.appendingPathComponent("Cinecrique-\(UUID().uuidString)", isDirectory: true)
        let packageDirectory = temporaryRoot.appendingPathComponent(baseName, isDirectory: true)
        try manager.createDirectory(at: packageDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? manager.removeItem(at: temporaryRoot) }

        for file in textFiles {
            try writeSingleText(file, to: packageDirectory.appendingPathComponent(file.name))
        }
        if includeVideo, let mediaURL {
            try copyVideo(from: mediaURL, to: packageDirectory.appendingPathComponent(mediaURL.lastPathComponent))
        }
        for frame in frames {
            guard let mediaURL else { throw ExportError.missingMedia }
            try writeFrame(frame, mediaURL: mediaURL, to: packageDirectory.appendingPathComponent(frame.name))
        }

        if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-c", "-k", "--norsrc", "--keepParent", packageDirectory.path, destination.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw ExportError.archiveFailed }
    }

    private static func draw(_ annotations: [[String: Any]], in context: CGContext, size: NSSize) {
        let gold = NSColor(calibratedRed: 0.91, green: 0.68, blue: 0.24, alpha: 1).cgColor
        context.setStrokeColor(gold)
        context.setFillColor(gold)
        context.setLineWidth(max(2, size.width / 640 * 2))
        context.setLineCap(.round)
        context.setLineJoin(.round)

        func x(_ value: Any?) -> CGFloat { CGFloat((value as? NSNumber)?.doubleValue ?? 0) * size.width }
        func y(_ value: Any?) -> CGFloat { (1 - CGFloat((value as? NSNumber)?.doubleValue ?? 0)) * size.height }

        for annotation in annotations.prefix(1_000) {
            switch annotation["type"] as? String {
            case "arrow":
                let start = CGPoint(x: x(annotation["x1"]), y: y(annotation["y1"]))
                let end = CGPoint(x: x(annotation["x2"]), y: y(annotation["y2"]))
                context.beginPath()
                context.move(to: start)
                context.addLine(to: end)
                let angle = atan2(end.y - start.y, end.x - start.x)
                let head = max(12, size.width / 70)
                context.move(to: end)
                context.addLine(to: CGPoint(x: end.x - head * cos(angle - .pi / 6), y: end.y - head * sin(angle - .pi / 6)))
                context.move(to: end)
                context.addLine(to: CGPoint(x: end.x - head * cos(angle + .pi / 6), y: end.y - head * sin(angle + .pi / 6)))
                context.strokePath()
            case "rect":
                let width = x(annotation["width"])
                let height = CGFloat((annotation["height"] as? NSNumber)?.doubleValue ?? 0) * size.height
                let rect = CGRect(x: x(annotation["x"]), y: y(annotation["y"]) - height, width: width, height: height)
                context.setLineDash(phase: 0, lengths: [8, 5])
                context.stroke(rect)
                context.setLineDash(phase: 0, lengths: [])
            case "point":
                let center = CGPoint(x: x(annotation["x"]), y: y(annotation["y"]))
                let radius = max(15, size.width / 85)
                context.setFillColor(NSColor(calibratedWhite: 0.05, alpha: 0.88).cgColor)
                context.fillEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
                context.setStrokeColor(gold)
                context.strokeEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
                let label = String((annotation["label"] as? NSNumber)?.intValue ?? 1) as NSString
                let fontSize = max(13, size.width / 80)
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: NSFont.monospacedSystemFont(ofSize: fontSize, weight: .semibold),
                    .foregroundColor: NSColor(cgColor: gold) ?? .systemYellow,
                ]
                let labelSize = label.size(withAttributes: attributes)
                label.draw(at: CGPoint(x: center.x - labelSize.width / 2, y: center.y - labelSize.height / 2), withAttributes: attributes)
            default:
                continue
            }
        }
    }

    enum ExportError: LocalizedError {
        case invalidText
        case missingMedia
        case frameRenderingFailed
        case archiveFailed

        var errorDescription: String? {
            switch self {
            case .invalidText: return "Le texte à exporter est invalide."
            case .missingMedia: return "Le média original est nécessaire pour exporter les images."
            case .frameRenderingFailed: return "L’image vidéo n’a pas pu être générée."
            case .archiveFailed: return "L’archive ZIP n’a pas pu être créée."
            }
        }
    }
}
