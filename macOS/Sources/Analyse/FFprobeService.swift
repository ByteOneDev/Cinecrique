import Foundation
import Darwin

enum FFprobeService {
    static var executableURL: URL? {
        MediaToolLocator.executableURL(named: "ffprobe")
    }

    static func inspect(_ fileURL: URL) throws -> [String: Any] {
        guard let executableURL else { throw ProbeError.notInstalled }

        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = executableURL
        process.arguments = [
            "-hide_banner",
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            fileURL.path
        ]
        process.standardOutput = output
        process.standardError = errors
        process.standardInput = FileHandle.nullDevice
        let termination = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in termination.signal() }

        try process.run()

        let readers = DispatchGroup()
        let outputQueue = DispatchQueue(label: "app.analyse.ffprobe.stdout")
        let errorQueue = DispatchQueue(label: "app.analyse.ffprobe.stderr")
        let outputResult = DataResultBox()
        let errorResult = DataResultBox()
        readers.enter()
        outputQueue.async {
            let result = Result { try readCapped(output.fileHandleForReading, maximumBytes: 16 * 1_024 * 1_024) }
            outputResult.set(result)
            if case .failure = result, process.isRunning {
                process.terminate()
            }
            readers.leave()
        }
        readers.enter()
        errorQueue.async {
            let result = Result { try readCapped(errors.fileHandleForReading, maximumBytes: 2 * 1_024 * 1_024) }
            errorResult.set(result)
            if case .failure = result, process.isRunning {
                process.terminate()
            }
            readers.leave()
        }

        if termination.wait(timeout: .now() + 20) == .timedOut {
            process.terminate()
            if termination.wait(timeout: .now() + 1) == .timedOut {
                kill(process.processIdentifier, SIGKILL)
                _ = termination.wait(timeout: .now() + 2)
            }
            readers.wait()
            throw ProbeError.timedOut
        }
        readers.wait()

        let data = try outputResult.value()
        let errorData = try errorResult.value()

        guard process.terminationStatus == 0 else {
            throw ProbeError.failed(sanitizedError(errorData))
        }

        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProbeError.invalidOutput
        }
        return object
    }

    private static func readCapped(_ handle: FileHandle, maximumBytes: Int) throws -> Data {
        var data = Data()
        data.reserveCapacity(min(maximumBytes, 256 * 1_024))
        while let chunk = try handle.read(upToCount: 64 * 1_024), !chunk.isEmpty {
            guard chunk.count <= maximumBytes, data.count <= maximumBytes - chunk.count else {
                throw ProbeError.outputTooLarge
            }
            data.append(chunk)
        }
        return data
    }

    private static func sanitizedError(_ data: Data) -> String {
        let raw = String(data: data, encoding: .utf8) ?? "ffprobe a échoué."
        let filtered = raw.unicodeScalars.filter { scalar in
            scalar == "\n" || scalar == "\t" || scalar.value >= 32
        }
        return String(String.UnicodeScalarView(filtered)).trimmingCharacters(in: .whitespacesAndNewlines).prefix(2_000).description
    }

    enum ProbeError: LocalizedError {
        case notInstalled
        case failed(String)
        case invalidOutput
        case outputTooLarge
        case timedOut

        var errorDescription: String? {
            switch self {
            case .notInstalled:
                return "Le moteur média ffprobe de Cinécrique est indisponible."
            case .failed(let message):
                return message
            case .invalidOutput:
                return "Les métadonnées du fichier ne sont pas lisibles."
            case .outputTooLarge:
                return "La sortie de ffprobe dépasse la limite autorisée."
            case .timedOut:
                return "L’analyse des métadonnées a dépassé 20 secondes."
            }
        }
    }

    private final class DataResultBox: @unchecked Sendable {
        private let lock = NSLock()
        private var result: Result<Data, Error>?

        func set(_ result: Result<Data, Error>) {
            lock.lock()
            self.result = result
            lock.unlock()
        }

        func value() throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            guard let result else { throw ProbeError.invalidOutput }
            return try result.get()
        }
    }
}
