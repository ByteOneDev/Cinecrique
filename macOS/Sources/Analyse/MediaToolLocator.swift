import Foundation
import AnalyseCore

enum MediaToolLocator {
    static func executableURL(named name: String) -> URL? {
        guard ["ffmpeg", "ffprobe"].contains(name) else { return nil }
        var candidates: [URL] = []
        if let resources = Bundle.main.resourceURL {
            candidates.append(resources.appendingPathComponent("Tools/\(name)"))
        }
#if DEBUG
        if MediaToolPolicy.allowsExternalDevelopmentFallback(
            isDebug: true,
            environmentValue: ProcessInfo.processInfo.environment["CINECRIQUE_ALLOW_EXTERNAL_MEDIA_TOOLS"]
        ) {
            candidates.append(contentsOf: [
                URL(fileURLWithPath: "/opt/homebrew/bin/\(name)"),
                URL(fileURLWithPath: "/usr/local/bin/\(name)"),
                URL(fileURLWithPath: "/opt/local/bin/\(name)"),
            ])
        }
#endif

        for candidate in candidates {
            let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
            if let resources = Bundle.main.resourceURL, candidate.path.hasPrefix(resources.path) {
                let toolsRoot = resources.appendingPathComponent("Tools", isDirectory: true).standardizedFileURL.path + "/"
                guard resolved.path.hasPrefix(toolsRoot) else { continue }
            }
            guard
                resolved.path.utf8.count <= 4_096,
                let values = try? resolved.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                values.isRegularFile == true,
                values.isSymbolicLink != true,
                FileManager.default.isExecutableFile(atPath: resolved.path)
            else { continue }
            return resolved
        }
        return nil
    }
}
