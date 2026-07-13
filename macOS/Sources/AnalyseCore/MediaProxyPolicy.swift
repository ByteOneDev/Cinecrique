import Foundation

public enum MediaProxyMode: String, Equatable, Sendable {
    case remux
    case transcodeAudio
    case transcodeVideo
}

public struct MediaProxyDecision: Equatable, Sendable {
    public let requiresProxy: Bool
    public let mode: MediaProxyMode?
    public let copyVideo: Bool
    public let copyAudio: Bool

    public init(requiresProxy: Bool, mode: MediaProxyMode?, copyVideo: Bool, copyAudio: Bool) {
        self.requiresProxy = requiresProxy
        self.mode = mode
        self.copyVideo = copyVideo
        self.copyAudio = copyAudio
    }
}

public enum MediaProxyPolicy {
    public static let directContainers: Set<String> = ["mov", "qt", "mp4", "m4v", "f4v"]
    public static let copyableVideoCodecs: Set<String> = ["h264", "hevc"]
    public static let copyableAudioCodecs: Set<String> = ["aac"]

    public static func decision(
        fileExtension: String,
        videoCodec: String?,
        audioCodecs: [String],
        forceProxy: Bool = false
    ) -> MediaProxyDecision {
        let container = fileExtension.lowercased()
        if !forceProxy && directContainers.contains(container) {
            return MediaProxyDecision(requiresProxy: false, mode: nil, copyVideo: true, copyAudio: true)
        }

        let normalizedVideo = videoCodec?.lowercased() ?? ""
        let normalizedAudio = audioCodecs.map { $0.lowercased() }
        let copyVideo = copyableVideoCodecs.contains(normalizedVideo)
        let copyAudio = normalizedAudio.allSatisfy(copyableAudioCodecs.contains)
        let mode: MediaProxyMode
        if copyVideo && copyAudio {
            mode = .remux
        } else if copyVideo {
            mode = .transcodeAudio
        } else {
            mode = .transcodeVideo
        }
        return MediaProxyDecision(
            requiresProxy: true,
            mode: mode,
            copyVideo: copyVideo,
            copyAudio: copyAudio
        )
    }
}
