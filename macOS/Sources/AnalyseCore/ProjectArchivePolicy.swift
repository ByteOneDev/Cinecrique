import Foundation

public enum ProjectArchivePolicy {
    public static let maxEntries = 2_000
    public static let maxArchiveBytes: Int64 = 50 * 1_024 * 1_024 * 1_024
    public static let maxExpandedBytes: Int64 = 100 * 1_024 * 1_024 * 1_024
    private static let minimumExpandedAllowance: Int64 = 512 * 1_024 * 1_024

    public static func validatedEntries(_ names: [String]) throws -> [String] {
        guard !names.isEmpty, names.count <= maxEntries else {
            throw ProjectArchiveError.invalidEntryCount
        }

        var destinations = Set<String>()
        return try names.map { name in
            guard
                !name.isEmpty,
                name.utf8.count <= 1_024,
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

            let destination = trimmed.precomposedStringWithCanonicalMapping.lowercased()
            guard destinations.insert(destination).inserted else {
                throw ProjectArchiveError.duplicateEntry
            }
            return name
        }
    }

    public static func expandedByteLimit(compressedBytes: Int64) -> Int64 {
        let safeCompressedBytes = max(0, compressedBytes)
        let scaled = safeCompressedBytes > maxExpandedBytes / 4
            ? maxExpandedBytes
            : safeCompressedBytes * 4
        return min(maxExpandedBytes, max(minimumExpandedAllowance, scaled))
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

public enum ProjectArchiveError: LocalizedError, Equatable {
    case invalidEntryCount
    case unsafeEntry
    case duplicateEntry
    case expandedDataTooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidEntryCount:
            return "L’archive Cinécrique est vide ou contient trop d’éléments."
        case .unsafeEntry:
            return "L’archive Cinécrique contient un chemin non sûr."
        case .duplicateEntry:
            return "L’archive Cinécrique contient des fichiers en conflit."
        case .expandedDataTooLarge:
            return "Le projet décompressé dépasse la limite de sécurité."
        }
    }
}
