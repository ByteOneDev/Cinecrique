import Darwin
import Foundation

public enum BoundedProcessRunner {
    @discardableResult
    public static func streamStandardOutput(
        executableURL: URL,
        arguments: [String],
        timeout: TimeInterval,
        chunkBytes: Int = 64 * 1_024,
        onChunk: @escaping (Data) throws -> Void
    ) throws -> Int32 {
        let process = Process()
        let output = Pipe()
        let termination = DispatchSemaphore(value: 0)
        let reader = DispatchSemaphore(value: 0)
        let state = ProcessState()

        process.executableURL = executableURL
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in termination.signal() }

        do {
            try process.run()
        } catch {
            throw BoundedProcessError.launchFailed
        }

        DispatchQueue.global(qos: .utility).async {
            defer { reader.signal() }
            do {
                while true {
                    let chunk = output.fileHandleForReading.readData(ofLength: chunkBytes)
                    if chunk.isEmpty { break }
                    try onChunk(chunk)
                }
            } catch {
                state.error = error
                if process.isRunning { process.terminate() }
            }
        }

        guard termination.wait(timeout: .now() + max(timeout, 0.1)) == .success else {
            terminate(process)
            _ = reader.wait(timeout: .now() + 2)
            throw BoundedProcessError.timedOut
        }
        guard reader.wait(timeout: .now() + 2) == .success else {
            terminate(process)
            throw BoundedProcessError.timedOut
        }
        if let error = state.error { throw error }
        return process.terminationStatus
    }

    private static func terminate(_ process: Process) {
        guard process.isRunning else { return }
        process.terminate()
        let pid = process.processIdentifier
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.5) {
            if process.isRunning { Darwin.kill(pid, SIGKILL) }
        }
    }

    private final class ProcessState: @unchecked Sendable {
        private let lock = NSLock()
        private var storedError: Error?

        var error: Error? {
            get { lock.withLock { storedError } }
            set { lock.withLock { storedError = newValue } }
        }
    }
}

public enum BoundedProcessError: Error, Equatable {
    case launchFailed
    case timedOut
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}
