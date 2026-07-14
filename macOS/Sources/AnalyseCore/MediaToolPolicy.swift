import Foundation

public enum MediaToolPolicy {
    public static func allowsExternalDevelopmentFallback(isDebug: Bool, environmentValue: String?) -> Bool {
        isDebug && environmentValue == "1"
    }
}
