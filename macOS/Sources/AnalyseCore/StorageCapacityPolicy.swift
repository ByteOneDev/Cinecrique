import Foundation

public enum StorageCapacityPolicy {
    public static let reserveBytes: Int64 = 512 * 1_024 * 1_024

    public static func requiredAvailableBytes(for payloadBytes: Int64) -> Int64 {
        let payload = max(0, payloadBytes)
        let overhead = payload > Int64.max / 10 ? Int64.max : payload / 10
        let withOverhead = payload > Int64.max - overhead ? Int64.max : payload + overhead
        return withOverhead > Int64.max - reserveBytes ? Int64.max : withOverhead + reserveBytes
    }

    public static func hasSufficientSpace(availableBytes: Int64, payloadBytes: Int64) -> Bool {
        availableBytes >= requiredAvailableBytes(for: payloadBytes)
    }

    public static func availableBytes(at url: URL, fileManager: FileManager = .default) throws -> Int64 {
        let values = try url.resourceValues(forKeys: [
            .volumeAvailableCapacityForImportantUsageKey,
            .volumeAvailableCapacityKey,
        ])
        var capacities: [Int64] = []
        if let value = values.volumeAvailableCapacityForImportantUsage, value >= 0 { capacities.append(value) }
        if let value = values.volumeAvailableCapacity, value >= 0 { capacities.append(Int64(value)) }
        if
            let attributes = try? fileManager.attributesOfFileSystem(forPath: url.path),
            let value = attributes[.systemFreeSize] as? NSNumber,
            value.int64Value >= 0
        {
            capacities.append(value.int64Value)
        }
        guard let available = capacities.min() else { throw StorageCapacityError.unavailable }
        return available
    }

    public static func ensureSpace(at url: URL, payloadBytes: Int64, fileManager: FileManager = .default) throws {
        guard hasSufficientSpace(
            availableBytes: try availableBytes(at: url, fileManager: fileManager),
            payloadBytes: payloadBytes
        ) else { throw StorageCapacityError.insufficientSpace }
    }
}

public enum StorageCapacityError: LocalizedError, Equatable {
    case unavailable
    case insufficientSpace

    public var errorDescription: String? {
        switch self {
        case .unavailable: return "L’espace disque disponible ne peut pas être vérifié."
        case .insufficientSpace: return "L’espace disque disponible est insuffisant pour cette opération."
        }
    }
}
