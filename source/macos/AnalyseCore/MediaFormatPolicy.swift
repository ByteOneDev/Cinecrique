import Foundation

public enum MediaFormatPolicy {
    public static let videoExtensions: Set<String> = [
        "mov", "qt", "mp4", "m4v", "f4v",
        "mkv", "webm",
        "avi", "divx",
        "mpg", "mpeg", "m1v", "m2v", "vob",
        "ts", "mts", "m2ts",
        "mxf",
        "3gp", "3g2",
        "ogv", "ogg",
        "wmv", "asf", "flv",
    ]

    public static func acceptsVideoExtension(_ value: String) -> Bool {
        videoExtensions.contains(value.lowercased())
    }
}

