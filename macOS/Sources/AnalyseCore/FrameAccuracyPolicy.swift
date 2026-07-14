import Foundation

public enum FrameAccuracyPolicy {
    public static func maximumDriftSeconds(frameRate: Double) -> Double {
        0.5 / max(frameRate, 1)
    }

    public static func validate(
        requestedSeconds: Double,
        actualSeconds: Double,
        frameRate: Double
    ) throws {
        guard requestedSeconds.isFinite, actualSeconds.isFinite else {
            throw FrameAccuracyError.invalidTime
        }
        let drift = abs(requestedSeconds - actualSeconds)
        guard drift <= maximumDriftSeconds(frameRate: frameRate) else {
            throw FrameAccuracyError.inexactFrame
        }
    }
}

public enum FrameAccuracyError: LocalizedError, Equatable {
    case invalidTime
    case inexactFrame

    public var errorDescription: String? {
        switch self {
        case .invalidTime:
            return "Le timecode demandé est invalide."
        case .inexactFrame:
            return "La frame exacte n’a pas pu être récupérée."
        }
    }
}
