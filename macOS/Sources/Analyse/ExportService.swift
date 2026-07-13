import AppKit
import AVFoundation
import Foundation
import AnalyseCore
import WebKit

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

    struct ProjectPackage {
        let state: [String: Any]
        let includeVideo: Bool
        let frames: [Frame]
    }

    struct ReportFrame {
        let title: String
        let timecode: String
        let time: Double
        let annotations: [[String: Any]]
    }

    struct Report {
        enum Format: String {
            case html
            case pdf
        }

        let name: String
        let format: Format
        let model: [String: Any]
        let frames: [ReportFrame]
    }

    struct ComparisonFrame {
        let title: String
        let timecode: String
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
        let png = try renderFrameData(time: frame.time, annotations: frame.annotations, mediaURL: mediaURL)
        try png.write(to: destination, options: .atomic)
    }

    private static func renderFrameData(time: Double, annotations: [[String: Any]], mediaURL: URL) throws -> Data {
        let asset = AVURLAsset(url: mediaURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 600)
        let requestedTime = CMTime(seconds: max(0, time), preferredTimescale: 600)
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
        draw(annotations, in: context, size: size)
        composed.unlockFocus()

        guard
            let tiff = composed.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
        else { throw ExportError.frameRenderingFailed }
        return png
    }

    static func renderPreview(time: Double, mediaURL: URL, maximumWidth: CGFloat) throws -> Data {
        let asset = AVURLAsset(url: mediaURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = NSSize(width: maximumWidth, height: maximumWidth)
        generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 24)
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 24)
        let image = try generator.copyCGImage(
            at: CMTime(seconds: max(0, time), preferredTimescale: 600),
            actualTime: nil
        )
        let representation = NSBitmapImageRep(cgImage: image)
        guard let data = representation.representation(using: .jpeg, properties: [.compressionFactor: 0.78]) else {
            throw ExportError.frameRenderingFailed
        }
        return data
    }

    static func writeArchive(
        named baseName: String,
        textFiles: [TextFile],
        originalMediaURL: URL?,
        renderMediaURL: URL?,
        includeVideo: Bool,
        frames: [Frame],
        reports: [Report],
        projectPackage: ProjectPackage?,
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
        if includeVideo, let originalMediaURL {
            try copyVideo(
                from: originalMediaURL,
                to: packageDirectory.appendingPathComponent(originalMediaURL.lastPathComponent)
            )
        }
        for frame in frames {
            guard let renderMediaURL else { throw ExportError.missingMedia }
            try writeFrame(frame, mediaURL: renderMediaURL, to: packageDirectory.appendingPathComponent(frame.name))
        }
        for report in reports {
            try writeReport(report, mediaURL: renderMediaURL, to: packageDirectory.appendingPathComponent(report.name))
        }
        if let projectPackage {
            try writeProjectPackage(
                projectPackage,
                named: baseName,
                originalMediaURL: originalMediaURL,
                renderMediaURL: renderMediaURL,
                to: packageDirectory.appendingPathComponent("\(baseName).cinecrique")
            )
        }

        try archiveDirectory(packageDirectory, keepingParent: true, to: destination)
    }

    static func writeReport(_ report: Report, mediaURL: URL?, to destination: URL) throws {
        var images: [ReportImage] = []
        if !report.frames.isEmpty {
            guard let mediaURL else { throw ExportError.missingMedia }
            images = try report.frames.prefix(100).map { frame in
                let png = try renderFrameData(time: frame.time, annotations: frame.annotations, mediaURL: mediaURL)
                return ReportImage(
                    title: frame.title,
                    timecode: frame.timecode,
                    dataURL: "data:image/png;base64,\(png.base64EncodedString())"
                )
            }
        }
        let html = ReportHTMLBuilder.build(model: report.model, images: images)
        switch report.format {
        case .html:
            guard let data = html.data(using: .utf8) else { throw ExportError.invalidText }
            try data.write(to: destination, options: .atomic)
        case .pdf:
            try ReportPDFRenderer.write(html: html, to: destination)
        }
    }

    static func writeComparison(
        a: ComparisonFrame,
        b: ComparisonFrame,
        note: String,
        mediaURL: URL,
        to destination: URL
    ) throws {
        let aData = try renderFrameData(time: a.time, annotations: a.annotations, mediaURL: mediaURL)
        let bData = try renderFrameData(time: b.time, annotations: b.annotations, mediaURL: mediaURL)
        guard let aImage = NSImage(data: aData), let bImage = NSImage(data: bData) else {
            throw ExportError.frameRenderingFailed
        }

        let canvasSize = NSSize(width: 2_400, height: 1_520)
        let canvas = NSImage(size: canvasSize)
        canvas.lockFocus()
        NSColor(calibratedRed: 0.045, green: 0.06, blue: 0.067, alpha: 1).setFill()
        NSRect(origin: .zero, size: canvasSize).fill()

        let margin: CGFloat = 60
        let gap: CGFloat = 32
        let labelHeight: CGFloat = 88
        let noteHeight: CGFloat = note.isEmpty ? 80 : 250
        let imageWidth = (canvasSize.width - margin * 2 - gap) / 2
        let imageHeight = canvasSize.height - margin * 2 - labelHeight - noteHeight
        let imageY = noteHeight + margin
        let leftRect = NSRect(x: margin, y: imageY, width: imageWidth, height: imageHeight)
        let rightRect = NSRect(x: margin + imageWidth + gap, y: imageY, width: imageWidth, height: imageHeight)

        drawComparisonImage(aImage, in: leftRect)
        drawComparisonImage(bImage, in: rightRect)
        drawComparisonLabel(a, label: "A", x: leftRect.minX, y: leftRect.maxY + 18, width: imageWidth)
        drawComparisonLabel(b, label: "B", x: rightRect.minX, y: rightRect.maxY + 18, width: imageWidth)

        if !note.isEmpty {
            let headingAttributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 19, weight: .semibold),
                .foregroundColor: NSColor(calibratedRed: 0.86, green: 0.65, blue: 0.25, alpha: 1),
            ]
            ("NOTE COMPARATIVE" as NSString).draw(at: NSPoint(x: margin, y: 182), withAttributes: headingAttributes)
            let style = NSMutableParagraphStyle()
            style.lineBreakMode = .byWordWrapping
            let noteAttributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedSystemFont(ofSize: 18, weight: .regular),
                .foregroundColor: NSColor(calibratedWhite: 0.86, alpha: 1),
                .paragraphStyle: style,
            ]
            (String(note.prefix(20_000)) as NSString).draw(
                in: NSRect(x: margin, y: 48, width: canvasSize.width - margin * 2, height: 122),
                withAttributes: noteAttributes
            )
        }
        canvas.unlockFocus()

        guard
            let tiff = canvas.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
        else { throw ExportError.frameRenderingFailed }
        try png.write(to: destination, options: .atomic)
    }

    static func writeProjectPackage(
        _ package: ProjectPackage,
        named baseName: String,
        originalMediaURL: URL?,
        renderMediaURL: URL?,
        to destination: URL
    ) throws {
        guard JSONSerialization.isValidJSONObject(package.state) else { throw ExportError.invalidProject }
        let projectData = try JSONSerialization.data(withJSONObject: package.state, options: [.prettyPrinted, .sortedKeys])
        guard projectData.count <= AppStateStore.maxStateBytes else { throw ExportError.projectTooLarge }

        let manager = FileManager.default
        let temporaryRoot = manager.temporaryDirectory.appendingPathComponent("Cinecrique-Project-\(UUID().uuidString)", isDirectory: true)
        let contentDirectory = temporaryRoot.appendingPathComponent(baseName, isDirectory: true)
        try manager.createDirectory(at: contentDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? manager.removeItem(at: temporaryRoot) }

        var manifest: [String: Any] = [
            "format": "app.cinecrique.project",
            "formatVersion": 1,
            "stateVersion": (package.state["version"] as? NSNumber)?.intValue ?? 1,
            "createdAt": ISO8601DateFormatter().string(from: Date()),
            "previewCount": package.frames.count,
            "portable": package.includeVideo,
        ]
        if package.includeVideo {
            guard let originalMediaURL else { throw ExportError.missingMedia }
            let mediaDirectory = contentDirectory.appendingPathComponent("Media", isDirectory: true)
            try manager.createDirectory(at: mediaDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let mediaName = ProjectArchivePolicy.portableMediaFileName(for: originalMediaURL.lastPathComponent)
            try copyVideo(from: originalMediaURL, to: mediaDirectory.appendingPathComponent(mediaName))
            manifest["embeddedMedia"] = "Media/\(mediaName)"
        }

        if !package.frames.isEmpty {
            guard let renderMediaURL else { throw ExportError.missingMedia }
            let previewsDirectory = contentDirectory.appendingPathComponent("Previews", isDirectory: true)
            try manager.createDirectory(at: previewsDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            for frame in package.frames {
                try writeFrame(frame, mediaURL: renderMediaURL, to: previewsDirectory.appendingPathComponent(frame.name))
            }
        }

        let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try manifestData.write(to: contentDirectory.appendingPathComponent("manifest.json"), options: .atomic)
        try projectData.write(to: contentDirectory.appendingPathComponent("project.json"), options: .atomic)
        try archiveDirectory(contentDirectory, keepingParent: false, to: destination)
    }

    private static func archiveDirectory(_ directory: URL, keepingParent: Bool, to destination: URL) throws {
        let manager = FileManager.default

        if manager.fileExists(atPath: destination.path) { try manager.removeItem(at: destination) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-c", "-k", "--norsrc"]
            + (keepingParent ? ["--keepParent"] : [])
            + [directory.path, destination.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw ExportError.archiveFailed }
    }

    private static func drawComparisonImage(_ image: NSImage, in rect: NSRect) {
        NSColor.black.setFill()
        rect.fill()
        let imageSize = image.size
        guard imageSize.width > 0, imageSize.height > 0 else { return }
        let scale = min(rect.width / imageSize.width, rect.height / imageSize.height)
        let targetSize = NSSize(width: imageSize.width * scale, height: imageSize.height * scale)
        let target = NSRect(
            x: rect.midX - targetSize.width / 2,
            y: rect.midY - targetSize.height / 2,
            width: targetSize.width,
            height: targetSize.height
        )
        image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1)
        NSColor(calibratedWhite: 0.28, alpha: 1).setStroke()
        NSBezierPath(rect: rect).stroke()
    }

    private static func drawComparisonLabel(_ frame: ComparisonFrame, label: String, x: CGFloat, y: CGFloat, width: CGFloat) {
        let labelAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 18, weight: .bold),
            .foregroundColor: NSColor(calibratedRed: 0.88, green: 0.67, blue: 0.28, alpha: 1),
        ]
        (label as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: labelAttributes)
        let timecodeAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 18, weight: .medium),
            .foregroundColor: NSColor(calibratedWhite: 0.9, alpha: 1),
        ]
        (frame.timecode as NSString).draw(at: NSPoint(x: x + 34, y: y), withAttributes: timecodeAttributes)
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 17, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.65, alpha: 1),
        ]
        (String(frame.title.prefix(500)) as NSString).draw(
            in: NSRect(x: x, y: y + 31, width: width, height: 34),
            withAttributes: titleAttributes
        )
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
            case "pencil":
                let points = (annotation["points"] as? [[String: Any]] ?? []).prefix(1_000)
                guard let first = points.first else { continue }
                context.setStrokeColor(gold)
                context.setLineDash(phase: 0, lengths: [])
                let width = max(1, (annotation["width"] as? NSNumber)?.doubleValue ?? 4)
                context.setLineWidth(max(1, CGFloat(width) * size.width / 640))
                context.beginPath()
                context.move(to: CGPoint(x: x(first["x"]), y: y(first["y"])))
                for point in points.dropFirst() {
                    context.addLine(to: CGPoint(x: x(point["x"]), y: y(point["y"])))
                }
                context.strokePath()
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
        case invalidProject
        case projectTooLarge
        case reportRenderingFailed
        case reportRenderingTimedOut

        var errorDescription: String? {
            switch self {
            case .invalidText: return "Le texte à exporter est invalide."
            case .missingMedia: return "Le média original est nécessaire pour exporter les images."
            case .frameRenderingFailed: return "L’image vidéo n’a pas pu être générée."
            case .archiveFailed: return "L’archive ZIP n’a pas pu être créée."
            case .invalidProject: return "Le projet Cinécrique est invalide."
            case .projectTooLarge: return "Le projet Cinécrique dépasse la limite de 32 Mo."
            case .reportRenderingFailed: return "Le rapport PDF n’a pas pu être généré."
            case .reportRenderingTimedOut: return "La génération du rapport PDF a dépassé le délai autorisé."
            }
        }
    }
}

private final class ReportPDFRenderer: NSObject, WKNavigationDelegate {
    private let html: String
    private let destination: URL
    private let semaphore = DispatchSemaphore(value: 0)
    private var renderingError: Error?
    private var completed = false
    private var webView: WKWebView?

    private init(html: String, destination: URL) {
        self.html = html
        self.destination = destination
    }

    static func write(html: String, to destination: URL) throws {
        guard !Thread.isMainThread else { throw ExportService.ExportError.reportRenderingFailed }
        let renderer = ReportPDFRenderer(html: html, destination: destination)
        DispatchQueue.main.async { renderer.start() }
        guard renderer.semaphore.wait(timeout: .now() + 60) == .success else {
            throw ExportService.ExportError.reportRenderingTimedOut
        }
        if let error = renderer.renderingError { throw error }
        guard
            let handle = try? FileHandle(forReadingFrom: destination),
            let prefix = try? handle.read(upToCount: 5),
            prefix == Data("%PDF-".utf8)
        else { throw ExportService.ExportError.reportRenderingFailed }
    }

    private func start() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = false
        configuration.defaultWebpagePreferences = preferences
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1_120, height: 792), configuration: configuration)
        view.navigationDelegate = self
        webView = view
        view.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.layoutSubtreeIfNeeded()
        let printInfo = NSPrintInfo.shared.copy() as! NSPrintInfo
        printInfo.paperSize = NSSize(width: 841.89, height: 595.28)
        printInfo.orientation = .landscape
        printInfo.topMargin = 28
        printInfo.bottomMargin = 28
        printInfo.leftMargin = 28
        printInfo.rightMargin = 28
        printInfo.jobDisposition = .save
        printInfo.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = destination
        let operation = webView.printOperation(with: printInfo)
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false
        guard operation.run() else {
            finish(ExportService.ExportError.reportRenderingFailed)
            return
        }
        finish(nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(error)
    }

    private func finish(_ error: Error?) {
        guard !completed else { return }
        completed = true
        renderingError = error
        webView?.navigationDelegate = nil
        webView = nil
        semaphore.signal()
    }
}
