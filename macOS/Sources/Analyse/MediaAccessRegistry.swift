import Foundation

final class MediaAccessRegistry {
    static let shared = MediaAccessRegistry()

    private let lock = NSLock()
    private var approvedPaths: Set<String> = []

    private init() {}

    @discardableResult
    func approve(_ fileURL: URL) -> URL {
        let normalizedURL = Self.normalizedURL(fileURL)
        lock.lock()
        approvedPaths.insert(normalizedURL.path)
        lock.unlock()
        return normalizedURL
    }

    func isApproved(_ fileURL: URL) -> Bool {
        let path = Self.normalizedURL(fileURL).path
        lock.lock()
        defer { lock.unlock() }
        return approvedPaths.contains(path)
    }

    static func normalizedURL(_ fileURL: URL) -> URL {
        fileURL.standardizedFileURL.resolvingSymlinksInPath()
    }
}
