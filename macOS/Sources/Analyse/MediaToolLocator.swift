import Foundation

enum MediaToolLocator {
    static func executableURL(named name: String) -> URL? {
        guard ["ffmpeg", "ffprobe"].contains(name) else { return nil }
        var candidates: [URL] = []
        if let resources = Bundle.main.resourceURL {
            candidates.append(resources.appendingPathComponent("Tools/\(name)"))
        }
        candidates.append(contentsOf: [
            URL(fileURLWithPath: "/opt/homebrew/bin/\(name)"),
            URL(fileURLWithPath: "/usr/local/bin/\(name)"),
            URL(fileURLWithPath: "/opt/local/bin/\(name)"),
        ])

        for candidate in candidates {
            let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
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
