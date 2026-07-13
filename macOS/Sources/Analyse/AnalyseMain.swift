import AppKit
import Darwin
import Foundation

@main
enum CinecriqueMain {
    static func main() {
        if CommandLine.arguments.dropFirst().first == "--check-media-proxy" {
            exit(runMediaProxyCheck(arguments: Array(CommandLine.arguments.dropFirst(2))))
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
}
