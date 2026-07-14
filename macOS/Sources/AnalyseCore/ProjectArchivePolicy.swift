import Foundation

public enum ProjectArchivePolicy {
    public static let maxEntries = 10_000
    public static let maxListingBytes = 8 * 1_024 * 1_024
    public static let maxEntryNameBytes = 4_096
    public static let maxTotalNameBytes = 8 * 1_024 * 1_024
    public static let maxArchiveBytes: Int64 = 50 * 1_024 * 1_024 * 1_024
    public static let maxExpandedBytes: Int64 = 100 * 1_024 * 1_024 * 1_024
    public static let listingTimeout: TimeInterval = 15
    private static let minimumExpandedAllowance: Int64 = 64 * 1_024 * 1_024
    private static let maximumCompressionRatio: Int64 = 200

    public static func validatedEntries(_ names: [String]) throws -> [String] {
        guard !names.isEmpty, names.count <= maxEntries else {
            throw ProjectArchiveError.invalidEntryCount
        }

        var destinations = Set<String>()
        var totalNameBytes = 0
        return try names.map { name in
            totalNameBytes += name.utf8.count
            guard
                !name.isEmpty,
                name.utf8.count <= maxEntryNameBytes,
                totalNameBytes <= maxTotalNameBytes,
                !name.hasPrefix("/"),
                !name.hasPrefix("\\"),
                !name.contains("\\"),
                !name.contains("*"),
                !name.contains("?"),
                !name.contains("["),
                name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            else { throw ProjectArchiveError.unsafeEntry }

            let trimmed = name.hasSuffix("/") ? String(name.dropLast()) : name
            let components = trimmed.split(separator: "/", omittingEmptySubsequences: false)
            guard
                !trimmed.isEmpty,
                components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
            else { throw ProjectArchiveError.unsafeEntry }

            let destination = trimmed
                .folding(options: [.caseInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .precomposedStringWithCanonicalMapping
            guard destinations.insert(destination).inserted else {
                throw ProjectArchiveError.duplicateEntry
            }
            return name
        }
    }

    public static func expandedByteLimit(compressedBytes: Int64) -> Int64 {
        let safeCompressedBytes = max(0, compressedBytes)
        let scaled = safeCompressedBytes > maxExpandedBytes / maximumCompressionRatio
            ? maxExpandedBytes
            : safeCompressedBytes * maximumCompressionRatio
        return min(maxExpandedBytes, max(minimumExpandedAllowance, scaled))
    }

    public static func validateExpansion(compressedBytes: Int64, expandedBytes: Int64) throws {
        guard expandedBytes >= 0, expandedBytes <= expandedByteLimit(compressedBytes: compressedBytes) else {
            throw ProjectArchiveError.expandedDataTooLarge
        }
    }

    public static func portableMediaFileName(for originalName: String) -> String {
        let rawExtension = URL(fileURLWithPath: originalName).pathExtension.lowercased()
        let asciiExtension = String(rawExtension.unicodeScalars.filter { scalar in
            (scalar.value >= 48 && scalar.value <= 57)
                || (scalar.value >= 97 && scalar.value <= 122)
        }.prefix(16))
        return asciiExtension.isEmpty ? "media" : "media.\(asciiExtension)"
    }
}

public final class ProjectArchiveListingAccumulator {
    private var pending = Data()
    private var names: [String] = []
    private var totalInputBytes = 0

    public init() {}

    public func append(_ chunk: Data) throws {
        guard chunk.count <= ProjectArchivePolicy.maxListingBytes - totalInputBytes else {
            throw ProjectArchiveError.listingTooLarge
        }
        totalInputBytes += chunk.count
        pending.append(chunk)

        while let newline = pending.firstIndex(of: 0x0A) {
            let line = Data(pending[..<newline])
            pending.removeSubrange(...newline)
            try appendLine(line)
        }
        guard pending.count <= ProjectArchivePolicy.maxEntryNameBytes + 1 else {
            throw ProjectArchiveError.unsafeEntry
        }
    }

    public func finish() throws -> [String] {
        if !pending.isEmpty {
            try appendLine(pending)
            pending.removeAll(keepingCapacity: false)
        }
        return try ProjectArchivePolicy.validatedEntries(names)
    }

    private func appendLine(_ rawLine: Data) throws {
        var line = rawLine
        if line.last == 0x0D { line.removeLast() }
        guard
            !line.isEmpty,
            line.count <= ProjectArchivePolicy.maxEntryNameBytes,
            names.count < ProjectArchivePolicy.maxEntries,
            let name = String(data: line, encoding: .utf8)
        else {
            throw names.count >= ProjectArchivePolicy.maxEntries
                ? ProjectArchiveError.invalidEntryCount
                : ProjectArchiveError.unsafeEntry
        }
        names.append(name)
    }
}

public enum ProjectArchiveError: LocalizedError, Equatable {
    case invalidEntryCount
    case listingTooLarge
    case unsafeEntry
    case duplicateEntry
    case expandedDataTooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidEntryCount:
            return "L’archive Cinécrique est vide ou contient trop d’éléments."
        case .listingTooLarge:
            return "La liste des fichiers de l’archive dépasse la limite de sécurité."
        case .unsafeEntry:
            return "L’archive Cinécrique contient un chemin non sûr."
        case .duplicateEntry:
            return "L’archive Cinécrique contient des fichiers en conflit."
        case .expandedDataTooLarge:
            return "Le projet décompressé dépasse la limite de sécurité."
        }
    }
}
