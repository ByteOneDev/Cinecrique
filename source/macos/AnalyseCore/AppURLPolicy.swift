import Foundation

public enum AppURLPolicy {
    public static func isTrustedAppURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "analyse-app"
            && url.host?.lowercased() == "local"
            && url.user == nil
            && url.password == nil
            && url.port == nil
    }

    public static func isTrustedMediaURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "analyse-media"
            && url.host?.lowercased() == "local"
            && url.user == nil
            && url.password == nil
            && url.port == nil
    }

    public static func isAllowedExternalURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            return false
        }
        return !(url.host?.isEmpty ?? true)
            && url.user == nil
            && url.password == nil
    }
}
