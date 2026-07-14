import Foundation

public enum PersistedStatePolicy {
    public static let maxProjects = 500
    public static let maxDocuments = 500
    public static let maxMarkersPerDocument = 25_000
    public static let maxAnnotationGroupsPerDocument = 25_000
    public static let maxAnnotationsPerMarker = 1_000
    public static let maxAnnotationsPerDocument = 100_000
    public static let maxPencilPoints = 1_000
    public static let maxSubtitleCuesPerDocument = 100_000
    public static let maxDocumentTextBytes = 8 * 1_024 * 1_024
    public static let maxStringBytes = 8 * 1_024 * 1_024
    public static let maxDepth = 32
    public static let maxTotalValues = 1_000_000
    public static let forbiddenKeys: Set<String> = ["__proto__", "prototype", "constructor"]

    public static func validate(_ rawState: Any) throws {
        guard let state = rawState as? [String: Any] else { throw PersistedStateError.invalidRoot }
        var budget = maxTotalValues
        try validateValue(state, depth: 0, budget: &budget, stringLimit: maxStringBytes)

        guard let projects = state["projects"] as? [Any], projects.count <= maxProjects else {
            throw PersistedStateError.tooManyProjects
        }
        let version = (state["version"] as? NSNumber)?.intValue ?? 0
        guard !projects.isEmpty || version >= 5 else { throw PersistedStateError.invalidRoot }
        guard projects.allSatisfy({ $0 is [String: Any] }) else { throw PersistedStateError.invalidRoot }

        let documents = state["documents"] as? [String: Any] ?? [:]
        guard documents.count <= maxDocuments else { throw PersistedStateError.tooManyDocuments }
        for value in documents.values {
            guard let document = value as? [String: Any] else { throw PersistedStateError.invalidDocument }
            try validateDocument(document)
        }
    }

    private static func validateDocument(_ document: [String: Any]) throws {
        for key in ["script", "analysis"] {
            if let text = document[key] as? String, text.utf8.count > maxDocumentTextBytes {
                throw PersistedStateError.documentTextTooLarge
            }
        }
        let markers = document["markers"] as? [Any] ?? []
        guard markers.count <= maxMarkersPerDocument else { throw PersistedStateError.tooManyMarkers }
        let subtitles = document["subtitleCues"] as? [Any] ?? []
        guard subtitles.count <= maxSubtitleCuesPerDocument else { throw PersistedStateError.tooManySubtitles }

        let groups = document["annotationsByMarker"] as? [String: Any] ?? [:]
        guard groups.count <= maxAnnotationGroupsPerDocument else { throw PersistedStateError.tooManyAnnotations }
        var annotationCount = 0
        for value in groups.values {
            guard let annotations = value as? [Any], annotations.count <= maxAnnotationsPerMarker else {
                throw PersistedStateError.tooManyAnnotations
            }
            annotationCount += annotations.count
            guard annotationCount <= maxAnnotationsPerDocument else { throw PersistedStateError.tooManyAnnotations }
            for case let annotation as [String: Any] in annotations where annotation["type"] as? String == "pencil" {
                guard (annotation["points"] as? [Any] ?? []).count <= maxPencilPoints else {
                    throw PersistedStateError.tooManyPencilPoints
                }
            }
        }
    }

    private static func validateValue(
        _ value: Any,
        depth: Int,
        budget: inout Int,
        stringLimit: Int
    ) throws {
        guard depth <= maxDepth else { throw PersistedStateError.tooDeep }
        budget -= 1
        guard budget >= 0 else { throw PersistedStateError.tooManyValues }
        if let string = value as? String {
            guard string.utf8.count <= stringLimit else { throw PersistedStateError.stringTooLarge }
            return
        }
        if let array = value as? [Any] {
            for item in array { try validateValue(item, depth: depth + 1, budget: &budget, stringLimit: stringLimit) }
            return
        }
        if let dictionary = value as? [String: Any] {
            for (key, item) in dictionary {
                guard !forbiddenKeys.contains(key), key.utf8.count <= 4_096 else {
                    throw PersistedStateError.unsafeKey
                }
                let limit = ["script", "analysis"].contains(key) ? maxDocumentTextBytes : stringLimit
                try validateValue(item, depth: depth + 1, budget: &budget, stringLimit: limit)
            }
        }
    }
}

public enum PersistedStateError: LocalizedError, Equatable {
    case invalidRoot
    case invalidDocument
    case tooManyProjects
    case tooManyDocuments
    case tooManyMarkers
    case tooManyAnnotations
    case tooManyPencilPoints
    case tooManySubtitles
    case documentTextTooLarge
    case stringTooLarge
    case unsafeKey
    case tooDeep
    case tooManyValues

    public var errorDescription: String? {
        switch self {
        case .invalidRoot, .invalidDocument: return "Les données du projet sont mal formées."
        case .tooManyProjects: return "Le projet importé contient trop de projets."
        case .tooManyDocuments: return "Le projet importé contient trop de documents."
        case .tooManyMarkers: return "Un document contient trop de repères."
        case .tooManyAnnotations: return "Un document contient trop d’annotations."
        case .tooManyPencilPoints: return "Une annotation crayon contient trop de points."
        case .tooManySubtitles: return "Un document contient trop de sous-titres."
        case .documentTextTooLarge, .stringTooLarge: return "Une donnée textuelle dépasse la limite autorisée."
        case .unsafeKey: return "Le projet contient une clé de données non sûre."
        case .tooDeep, .tooManyValues: return "La structure du projet est trop complexe."
        }
    }
}
