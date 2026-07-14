import Foundation

public final class AppStateStore {
    public static let maxStateBytes = 32 * 1_024 * 1_024

    private let fileManager: FileManager
    private let stateURL: URL
    private let snapshotsDirectoryURL: URL
    private var lastSnapshotMilliseconds = 0
    public private(set) var recoveredFromSnapshot = false

    public convenience init(fileManager: FileManager = .default) throws {
        let supportRoot = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        try self.init(
            directory: supportRoot.appendingPathComponent("Cinecrique", isDirectory: true),
            legacyDirectory: supportRoot.appendingPathComponent("Analyse", isDirectory: true),
            fileManager: fileManager
        )
    }

    public convenience init(testDirectory: URL, fileManager: FileManager = .default) throws {
        try self.init(directory: testDirectory, legacyDirectory: nil, fileManager: fileManager)
    }

    private init(directory: URL, legacyDirectory: URL?, fileManager: FileManager) throws {
        self.fileManager = fileManager
        stateURL = directory.appendingPathComponent("state.json")
        snapshotsDirectoryURL = directory.appendingPathComponent("Snapshots", isDirectory: true)

        try ensurePrivateDirectory(directory, withIntermediateDirectories: true)
        try ensurePrivateDirectory(snapshotsDirectoryURL, withIntermediateDirectories: false)
        if let legacyDirectory { try migrateLegacyStateIfNeeded(from: legacyDirectory) }
    }

    public func save(_ state: Any) throws {
        guard JSONSerialization.isValidJSONObject(state) else {
            throw StoreError.invalidState
        }
        if fileManager.fileExists(atPath: stateURL.path) {
            let values = try stateURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else {
                throw StoreError.unsafeLocation
            }
        }
        let data = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        guard data.count <= Self.maxStateBytes else { throw StoreError.stateTooLarge }
        try snapshotCurrentStateIfNeeded(replacingWith: data)
        try data.write(to: stateURL, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
    }

    public func load() throws -> Any? {
        recoveredFromSnapshot = false
        guard fileManager.fileExists(atPath: stateURL.path) else { return nil }
        do {
            return try loadState(at: stateURL)
        } catch {
            try preserveCorruptState()
            guard let recovered = try latestValidSnapshot() else { throw error }
            let data = try JSONSerialization.data(withJSONObject: recovered, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: stateURL, options: .atomic)
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
            recoveredFromSnapshot = true
            return recovered
        }
    }

    public var directoryPath: String {
        stateURL.deletingLastPathComponent().path
    }

    @discardableResult
    public func createRestorableSnapshot() throws -> String? {
        guard fileManager.fileExists(atPath: stateURL.path) else { return nil }
        let values = try stateURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw StoreError.unsafeLocation }
        guard let size = values.fileSize, size <= Self.maxStateBytes else { throw StoreError.stateTooLarge }
        let data = try Data(contentsOf: stateURL)
        guard (try JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw StoreError.invalidState }
        return try writeSnapshot(data).lastPathComponent
    }

    public func restoreSnapshot(named name: String) throws -> Any {
        guard
            name == URL(fileURLWithPath: name).lastPathComponent,
            name.hasPrefix("snapshot-"),
            name.hasSuffix(".json"),
            name.utf8.count <= 256
        else { throw StoreError.invalidSnapshot }
        try validateSnapshotsDirectory()
        let snapshotURL = snapshotsDirectoryURL.appendingPathComponent(name)
        let state = try loadState(at: snapshotURL)
        try save(state)
        return state
    }

    private func loadState(at url: URL) throws -> [String: Any] {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw StoreError.invalidState }
        guard let fileSize = values.fileSize, fileSize <= Self.maxStateBytes else { throw StoreError.stateTooLarge }
        let data = try Data(contentsOf: url)
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let state = object as? [String: Any]
        else {
            throw StoreError.invalidState
        }
        return state
    }

    private func snapshotCurrentStateIfNeeded(replacingWith nextData: Data) throws {
        guard fileManager.fileExists(atPath: stateURL.path) else { return }
        let values = try stateURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw StoreError.unsafeLocation }
        guard let size = values.fileSize, size <= Self.maxStateBytes else { throw StoreError.stateTooLarge }
        let currentData = try Data(contentsOf: stateURL)
        guard currentData != nextData else { return }

        _ = try writeSnapshot(currentData)
    }

    private func writeSnapshot(_ data: Data) throws -> URL {
        try validateSnapshotsDirectory()
        let now = Int(Date().timeIntervalSince1970 * 1_000)
        let milliseconds = max(now, lastSnapshotMilliseconds + 1)
        lastSnapshotMilliseconds = milliseconds
        let snapshotURL = snapshotsDirectoryURL.appendingPathComponent("snapshot-\(milliseconds)-\(UUID().uuidString).json")
        try data.write(to: snapshotURL, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: snapshotURL.path)
        try pruneSnapshots()
        return snapshotURL
    }

    private func snapshotURLsNewestFirst() throws -> [URL] {
        try validateSnapshotsDirectory()
        let urls = try fileManager.contentsOfDirectory(
            at: snapshotsDirectoryURL,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        )
        return try urls.filter { url in
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            return url.pathExtension == "json" && values.isRegularFile == true && values.isSymbolicLink != true
        }.sorted { $0.lastPathComponent > $1.lastPathComponent }
    }

    private func pruneSnapshots() throws {
        for url in try snapshotURLsNewestFirst().dropFirst(10) {
            try fileManager.removeItem(at: url)
        }
    }

    private func latestValidSnapshot() throws -> [String: Any]? {
        for url in try snapshotURLsNewestFirst() {
            if let state = try? loadState(at: url) { return state }
        }
        return nil
    }

    private func preserveCorruptState() throws {
        guard fileManager.fileExists(atPath: stateURL.path) else { return }
        let timestamp = Int(Date().timeIntervalSince1970)
        let destination = stateURL.deletingLastPathComponent().appendingPathComponent("state-corrompu-\(timestamp).json")
        if !fileManager.fileExists(atPath: destination.path) {
            try fileManager.copyItem(at: stateURL, to: destination)
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        }
    }

    private func migrateLegacyStateIfNeeded(from legacyDirectory: URL) throws {
        guard !fileManager.fileExists(atPath: stateURL.path) else { return }
        let legacyStateURL = legacyDirectory.appendingPathComponent("state.json")
        guard fileManager.fileExists(atPath: legacyStateURL.path) else { return }

        let directoryValues = try legacyDirectory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        let stateValues = try legacyStateURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard
            directoryValues.isDirectory == true,
            directoryValues.isSymbolicLink != true,
            stateValues.isRegularFile == true,
            stateValues.isSymbolicLink != true,
            let fileSize = stateValues.fileSize,
            fileSize <= Self.maxStateBytes
        else {
            throw StoreError.unsafeLocation
        }

        let data = try Data(contentsOf: legacyStateURL)
        guard (try JSONSerialization.jsonObject(with: data)) is [String: Any] else {
            throw StoreError.invalidState
        }
        try data.write(to: stateURL, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
    }

    private func ensurePrivateDirectory(_ url: URL, withIntermediateDirectories: Bool) throws {
        if fileManager.fileExists(atPath: url.path) {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                throw StoreError.unsafeLocation
            }
        } else {
            try fileManager.createDirectory(
                at: url,
                withIntermediateDirectories: withIntermediateDirectories,
                attributes: [.posixPermissions: 0o700]
            )
        }
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    private func validateSnapshotsDirectory() throws {
        let values = try snapshotsDirectoryURL.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw StoreError.unsafeLocation }
    }

    enum StoreError: LocalizedError {
        case invalidState
        case stateTooLarge
        case unsafeLocation
        case invalidSnapshot

        var errorDescription: String? {
            switch self {
            case .invalidState:
                return "L’état du projet est invalide."
            case .stateTooLarge:
                return "L’état du projet dépasse la limite de 32 Mo."
            case .unsafeLocation:
                return "L’emplacement de sauvegarde local n’est pas sûr."
            case .invalidSnapshot:
                return "Le snapshot demandé est invalide."
            }
        }
    }
}
