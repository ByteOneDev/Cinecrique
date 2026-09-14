import Foundation
import UniformTypeIdentifiers
import WebKit
import AnalyseCore

final class BundledAppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let resourceRoot: URL?

    override init() {
        resourceRoot = Bundle.main.resourceURL?
            .appendingPathComponent("WebApp", isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard
            let requestURL = urlSchemeTask.request.url,
            AppURLPolicy.isTrustedAppURL(requestURL),
            urlSchemeTask.request.httpMethod == nil || urlSchemeTask.request.httpMethod == "GET",
            let resourceRoot
        else {
            urlSchemeTask.didFailWithError(AppResourceError.missingRoot)
            return
        }

        let rawPath = requestURL.path.isEmpty ? "/index.html" : requestURL.path
        let relativePath = String(rawPath.drop(while: { $0 == "/" }))
        guard
            !relativePath.isEmpty,
            relativePath.utf8.count <= 1_024,
            !relativePath.contains(".."),
            !relativePath.contains("\0")
        else {
            urlSchemeTask.didFailWithError(AppResourceError.invalidPath)
            return
        }

        let fileURL = resourceRoot
            .appendingPathComponent(relativePath)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        let normalizedRoot = resourceRoot.path
        let rootPrefix = normalizedRoot.hasSuffix("/") ? normalizedRoot : normalizedRoot + "/"
        guard
            fileURL.path.hasPrefix(rootPrefix),
            Self.allowedExtensions.contains(fileURL.pathExtension.lowercased()),
            FileManager.default.isReadableFile(atPath: fileURL.path)
        else {
            urlSchemeTask.didFailWithError(AppResourceError.invalidPath)
            return
        }

        do {
            let values = try fileURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
            guard
                values.isRegularFile == true,
                let fileSize = values.fileSize,
                fileSize >= 0,
                fileSize <= Self.maximumResourceBytes
            else {
                throw AppResourceError.invalidPath
            }
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let contentType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": contentType,
                    "Content-Length": String(data.count),
                    "Cache-Control": "no-store",
                    "Content-Security-Policy": Self.contentSecurityPolicy,
                    "Referrer-Policy": "no-referrer",
                    "X-Content-Type-Options": "nosniff",
                    "X-Frame-Options": "DENY"
                ]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static let allowedExtensions: Set<String> = [
        "html", "js", "css", "png", "jpg", "jpeg", "webp", "svg", "ico", "woff", "woff2", "ttf"
    ]
    private static let maximumResourceBytes = 16 * 1_024 * 1_024

    private static let contentSecurityPolicy = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src analyse-media: blob:",
        "connect-src 'none'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "worker-src 'none'"
    ].joined(separator: "; ")

    enum AppResourceError: LocalizedError {
        case missingRoot
        case invalidPath

        var errorDescription: String? {
            switch self {
            case .missingRoot: return "Les ressources embarquées sont introuvables."
            case .invalidPath: return "Le chemin de ressource est invalide."
            }
        }
    }
}
