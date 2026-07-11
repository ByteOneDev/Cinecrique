import Foundation

public struct ByteRange: Equatable, Sendable {
    public let start: UInt64
    public let end: UInt64

    public var length: UInt64 { end - start + 1 }

    public init(start: UInt64, end: UInt64) {
        self.start = start
        self.end = end
    }
}

public enum ByteRangeError: Error, Equatable {
    case invalid
    case unsatisfiable
}

public enum ByteRangeParser {
    public static func parse(_ header: String?, totalSize: UInt64) throws -> ByteRange {
        guard totalSize > 0 else { throw ByteRangeError.unsatisfiable }
        guard let header, !header.isEmpty else {
            return ByteRange(start: 0, end: totalSize - 1)
        }

        guard header.hasPrefix("bytes=") else { throw ByteRangeError.invalid }
        let specification = String(header.dropFirst("bytes=".count))
        guard !specification.contains(",") else { throw ByteRangeError.invalid }

        let pieces = specification.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 2 else { throw ByteRangeError.invalid }

        if pieces[0].isEmpty {
            guard let suffixLength = UInt64(pieces[1]), suffixLength > 0 else {
                throw ByteRangeError.invalid
            }
            let length = min(suffixLength, totalSize)
            return ByteRange(start: totalSize - length, end: totalSize - 1)
        }

        guard let start = UInt64(pieces[0]), start < totalSize else {
            throw ByteRangeError.unsatisfiable
        }

        let end: UInt64
        if pieces[1].isEmpty {
            end = totalSize - 1
        } else {
            guard let requestedEnd = UInt64(pieces[1]), requestedEnd >= start else {
                throw ByteRangeError.invalid
            }
            end = min(requestedEnd, totalSize - 1)
        }

        return ByteRange(start: start, end: end)
    }
}
