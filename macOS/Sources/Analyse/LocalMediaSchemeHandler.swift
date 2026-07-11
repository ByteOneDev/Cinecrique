import Foundation
import UniformTypeIdentifiers
import WebKit
import AnalyseCore

final class LocalMediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "app.analyse.media-stream", qos: .userInitiated)
    private let cancellationLock = NSLock()
    private var cancelledTasks: Set<ObjectIdentifier> = []
    private var activeTasks: Set<ObjectIdentifier> = []

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        cancellationLock.lock()
        activeTasks.insert(identifier)
        cancelledTasks.remove(identifier)
        cancellationLock.unlock()
        queue.async { [weak self] in
            self?.serve(urlSchemeTask, identifier: identifier)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        cancellationLock.lock()
        if activeTasks.contains(identifier) {
            cancelledTasks.insert(identifier)
        }
        cancellationLock.unlock()
    }

    private func serve(_ task: WKURLSchemeTask, identifier: ObjectIdentifier) {
        defer {
            cancellationLock.lock()
            activeTasks.remove(identifier)
            cancelledTasks.remove(identifier)
            cancellationLock.unlock()
        }
        guard
            let requestURL = task.request.url,
            AppURLPolicy.isTrustedMediaURL(requestURL),
            task.request.httpMethod == nil || task.request.httpMethod == "GET",
            let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false),
            let path = components.queryItems?.first(where: { $0.name == "path" })?.value,
            path.utf8.count <= 16_384
        else {
            deliver(identifier) { task.didFailWithError(MediaError.invalidURL) }
            return
        }

        let fileURL = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
        guard MediaAccessRegistry.shared.isApproved(fileURL) else {
            deliver(identifier) { task.didFailWithError(MediaError.accessDenied) }
            return
        }
        guard Self.videoExtensions.contains(fileURL.pathExtension.lowercased()) else {
            deliver(identifier) { task.didFailWithError(MediaError.invalidType) }
            return
        }

        do {
            let values = try fileURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
            guard values.isRegularFile == true, let fileSize = values.fileSize else {
                throw MediaError.notAFile
            }

            let totalSize = UInt64(fileSize)
            let rangeHeader = task.request.value(forHTTPHeaderField: "Range")
            let byteRange: ByteRange
            do {
                byteRange = try ByteRangeParser.parse(rangeHeader, totalSize: totalSize)
            } catch ByteRangeError.unsatisfiable {
                let response = HTTPURLResponse(
                    url: requestURL,
                    statusCode: 416,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Range": "bytes */\(totalSize)"]
                )!
                guard deliver(identifier, { task.didReceive(response) }) else { return }
                deliver(identifier) { task.didFinish() }
                return
            }

            let contentType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            var headers = [
                "Accept-Ranges": "bytes",
                "Content-Length": String(byteRange.length),
                "Content-Type": contentType,
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'none'",
                "X-Content-Type-Options": "nosniff"
            ]
            let statusCode: Int
            if rangeHeader == nil {
                statusCode = 200
            } else {
                statusCode = 206
                headers["Content-Range"] = "bytes \(byteRange.start)-\(byteRange.end)/\(totalSize)"
            }

            let response = HTTPURLResponse(
                url: requestURL,
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!
            guard deliver(identifier, { task.didReceive(response) }) else { return }

            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            try handle.seek(toOffset: byteRange.start)

            var remaining = byteRange.length
            let chunkSize: UInt64 = 256 * 1024
            while remaining > 0, !isCancelled(identifier) {
                let count = Int(min(chunkSize, remaining))
                guard let data = try handle.read(upToCount: count), !data.isEmpty else { break }
                guard deliver(identifier, { task.didReceive(data) }) else { return }
                remaining -= UInt64(data.count)
            }

            guard !isCancelled(identifier) else { return }
            guard remaining == 0 else { throw MediaError.unexpectedEndOfFile }
            deliver(identifier) { task.didFinish() }
        } catch {
            deliver(identifier) { task.didFailWithError(error) }
        }
    }

    @discardableResult
    private func deliver(_ identifier: ObjectIdentifier, _ action: @escaping () -> Void) -> Bool {
        var delivered = false
        let guardedAction = { [weak self] in
            guard let self else { return }
            self.cancellationLock.lock()
            let isActive = self.activeTasks.contains(identifier) && !self.cancelledTasks.contains(identifier)
            self.cancellationLock.unlock()
            guard isActive else { return }
            action()
            delivered = true
        }

        if Thread.isMainThread {
            guardedAction()
        } else {
            DispatchQueue.main.sync(execute: guardedAction)
        }
        return delivered
    }

    private func isCancelled(_ identifier: ObjectIdentifier) -> Bool {
        cancellationLock.lock()
        defer { cancellationLock.unlock() }
        return cancelledTasks.contains(identifier)
    }

    enum MediaError: LocalizedError {
        case invalidURL
        case accessDenied
        case invalidType
        case notAFile
        case unexpectedEndOfFile

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "L’URL média locale est invalide."
            case .accessDenied:
                return "Ce fichier n’a pas été autorisé par l’application."
            case .invalidType:
                return "Ce type de fichier média n’est pas pris en charge."
            case .notAFile:
                return "Le média local n’est pas un fichier régulier."
            case .unexpectedEndOfFile:
                return "Le média local a été modifié pendant sa lecture."
            }
        }
    }

    private static let videoExtensions: Set<String> = [
        "mov", "mp4", "m4v", "mkv", "avi", "webm", "mpg", "mpeg", "ts", "m2ts"
    ]
}
