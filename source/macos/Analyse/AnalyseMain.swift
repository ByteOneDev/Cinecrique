import AppKit
import Darwin
import Foundation
import AnalyseCore

@main
enum CinecriqueMain {
    static func main() {
        if CommandLine.arguments.dropFirst().first == "--check-media-proxy" {
            exit(runMediaProxyCheck(arguments: Array(CommandLine.arguments.dropFirst(2))))
        }
        if CommandLine.arguments.dropFirst().first == "--check-exact-frame" {
            exit(runExactFrameCheck(arguments: Array(CommandLine.arguments.dropFirst(2))))
        }
        if CommandLine.arguments.dropFirst().first == "--check-window-drag" {
            exit(runWindowDragCheck(arguments: Array(CommandLine.arguments.dropFirst(2))))
        }
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
        _ = delegate
    }

    private static func runMediaProxyCheck(arguments: [String]) -> Int32 {
        guard arguments.count == 2 else {
            fputs("usage: Cinecrique --check-media-proxy <source> <temporary-support-directory>\n", stderr)
            return 2
        }
        do {
            let sourceURL = URL(fileURLWithPath: arguments[0]).standardizedFileURL
            let supportURL = URL(fileURLWithPath: arguments[1], isDirectory: true).standardizedFileURL
            let metadata = try FFprobeService.inspect(sourceURL)
            let service = try MediaProxyService(applicationSupportDirectory: supportURL)
            let prepared = try service.prepare(
                originalURL: sourceURL,
                metadata: metadata,
                operationID: "command-line-check"
            ) { _ in }
            let result: [String: Any] = [
                "mode": prepared.mode?.rawValue ?? "direct",
                "playbackPath": prepared.playbackURL.path,
                "proxyUsed": prepared.proxyUsed,
                "reused": prepared.reused,
                "subtitleExtracted": prepared.subtitle != nil,
            ]
            let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return 0
        } catch {
            fputs("media proxy check failed: \(error.localizedDescription)\n", stderr)
            return 1
        }
    }

    /// Verifies that the window drag band really ends up where the policy says,
    /// on the shipped binary rather than on a rebuilt copy of the layout.
    private static func runWindowDragCheck(arguments: [String]) -> Int32 {
        let width = Double(arguments.first ?? "1440") ?? 1_440
        let height = Double(arguments.dropFirst().first ?? "920") ?? 920
        let size = NSSize(width: width, height: height)

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        let content = NSView()
        content.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            content.topAnchor.constraint(equalTo: container.topAnchor),
            content.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        let band = WindowDragView.install(in: container, above: content)
        container.layoutSubtreeIfNeeded()

        let expected = WindowDragPolicy.bandRect(forWindowSize: size)
        // `container` is unflipped, so the band sits at the top of the window.
        let actual = NSRect(
            x: band.frame.minX,
            y: size.height - band.frame.maxY,
            width: band.frame.width,
            height: band.frame.height
        )
        let tolerance = 0.5
        // An unusable band is expressed as an empty rect by the policy and as a
        // zero-width view by Auto Layout: both mean nothing is draggable.
        let matches: Bool
        if expected.isEmpty {
            matches = actual.width <= tolerance
        } else {
            matches = abs(actual.minX - expected.minX) <= tolerance
                && abs(actual.minY - expected.minY) <= tolerance
                && abs(actual.width - expected.width) <= tolerance
                && abs(actual.height - expected.height) <= tolerance
        }
        let isAboveContent = container.subviews.last === band

        guard matches, isAboveContent else {
            fputs(
                "window drag check failed: expected \(expected), got \(actual), above content: \(isAboveContent)\n",
                stderr
            )
            return 1
        }

        let result: [String: Any] = [
            "x": actual.minX,
            "y": actual.minY,
            "width": actual.width,
            "height": actual.height,
            "aboveContent": isAboveContent,
        ]
        let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        if let data {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
        return 0
    }

    private static func runExactFrameCheck(arguments: [String]) -> Int32 {
        guard arguments.count == 3, let time = Double(arguments[1]) else {
            fputs("usage: Cinecrique --check-exact-frame <source> <time-seconds> <png-output>\n", stderr)
            return 2
        }
        do {
            let sourceURL = URL(fileURLWithPath: arguments[0]).standardizedFileURL
            let outputURL = URL(fileURLWithPath: arguments[2]).standardizedFileURL
            try ExportService.writeFrame(
                ExportService.Frame(name: outputURL.lastPathComponent, time: time, annotations: []),
                mediaURL: sourceURL,
                to: outputURL
            )
            let result: [String: Any] = ["time": time, "path": outputURL.path]
            let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return 0
        } catch {
            fputs("exact frame check failed: \(error.localizedDescription)\n", stderr)
            return 1
        }
    }
}
