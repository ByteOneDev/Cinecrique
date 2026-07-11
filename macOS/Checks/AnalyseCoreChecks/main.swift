import Foundation
import AnalyseCore

enum CheckError: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case .failed(let message): return message
        }
    }
}

func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw CheckError.failed(message) }
}

do {
    try expect(
        try ByteRangeParser.parse(nil, totalSize: 1_000) == ByteRange(start: 0, end: 999),
        "whole-file range"
    )
    try expect(
        try ByteRangeParser.parse("bytes=100-199", totalSize: 1_000) == ByteRange(start: 100, end: 199),
        "explicit range"
    )
    try expect(
        try ByteRangeParser.parse("bytes=950-", totalSize: 1_000) == ByteRange(start: 950, end: 999),
        "open-ended range"
    )
    try expect(
        try ByteRangeParser.parse("bytes=-120", totalSize: 1_000) == ByteRange(start: 880, end: 999),
        "suffix range"
    )

    do {
        _ = try ByteRangeParser.parse("bytes=1000-", totalSize: 1_000)
        throw CheckError.failed("unsatisfiable range should throw")
    } catch ByteRangeError.unsatisfiable {
        // Expected.
    }

    do {
        _ = try ByteRangeParser.parse("bytes=200-100", totalSize: 1_000)
        throw CheckError.failed("reversed range should throw")
    } catch ByteRangeError.invalid {
        // Expected.
    }

    do {
        _ = try ByteRangeParser.parse("bytes=0-1,4-5", totalSize: 1_000)
        throw CheckError.failed("multiple ranges should throw")
    } catch ByteRangeError.invalid {
        // Expected.
    }

    do {
        _ = try ByteRangeParser.parse("items=0-1", totalSize: 1_000)
        throw CheckError.failed("unknown range unit should throw")
    } catch ByteRangeError.invalid {
        // Expected.
    }

    do {
        _ = try ByteRangeParser.parse("bytes=-0", totalSize: 1_000)
        throw CheckError.failed("zero suffix range should throw")
    } catch ByteRangeError.invalid {
        // Expected.
    }

    do {
        _ = try ByteRangeParser.parse(nil, totalSize: 0)
        throw CheckError.failed("empty media should be unsatisfiable")
    } catch ByteRangeError.unsatisfiable {
        // Expected.
    }

    try expect(
        AppURLPolicy.isTrustedAppURL(URL(string: "analyse-app://local/index.html")!),
        "trusted app origin"
    )
    try expect(
        !AppURLPolicy.isTrustedAppURL(URL(string: "analyse-app://remote/index.html")!),
        "reject foreign app host"
    )
    try expect(
        !AppURLPolicy.isTrustedAppURL(URL(string: "analyse-app://user:secret@local/index.html")!),
        "reject app URL credentials"
    )
    try expect(
        AppURLPolicy.isTrustedMediaURL(URL(string: "analyse-media://local?path=/tmp/movie.mp4")!),
        "trusted media origin"
    )
    try expect(
        AppURLPolicy.isAllowedExternalURL(URL(string: "https://www.themoviedb.org/movie/1")!),
        "allow https external URL"
    )
    try expect(
        !AppURLPolicy.isAllowedExternalURL(URL(string: "file:///etc/passwd")!),
        "reject file external URL"
    )
    try expect(
        !AppURLPolicy.isAllowedExternalURL(URL(string: "https://user:secret@example.com/")!),
        "reject URL credentials"
    )
    try expect(
        !AppURLPolicy.isAllowedExternalURL(URL(string: "javascript:alert(1)")!),
        "reject executable external URL"
    )

    let archiveEntries = try ProjectArchivePolicy.validatedEntries([
        "manifest.json", "project.json", "Previews/frame-01.png", "Media/film.mov"
    ])
    try expect(archiveEntries.count == 4, "accept safe project archive entries")
    do {
        _ = try ProjectArchivePolicy.validatedEntries(["manifest.json", "../state.json"])
        throw CheckError.failed("archive traversal should throw")
    } catch ProjectArchiveError.unsafeEntry {
        // Expected.
    }
    do {
        _ = try ProjectArchivePolicy.validatedEntries(["Project.json", "project.json"])
        throw CheckError.failed("case-insensitive archive collision should throw")
    } catch ProjectArchiveError.duplicateEntry {
        // Expected.
    }
    try expect(
        ProjectArchivePolicy.expandedByteLimit(compressedBytes: 1_024) == 512 * 1_024 * 1_024,
        "archive expansion allowance has a bounded minimum"
    )
    try expect(
        ProjectArchivePolicy.portableMediaFileName(for: "Un film à Marseille.MP4") == "media.mp4",
        "portable media names remain ASCII and preserve the extension"
    )
    try expect(
        ProjectArchivePolicy.portableMediaFileName(for: "film.🎞") == "media",
        "portable media names reject unsafe extensions"
    )

    let fileManager = FileManager.default
    let storeDirectory = fileManager.temporaryDirectory
        .appendingPathComponent("Cinecrique-StateChecks-\(UUID().uuidString)", isDirectory: true)
    defer { try? fileManager.removeItem(at: storeDirectory) }
    let store = try AppStateStore(testDirectory: storeDirectory)
    for version in 0...12 {
        try store.save(["version": version, "projects": [["id": "test", "title": "Version \(version)"]]])
    }
    let snapshotsDirectory = storeDirectory.appendingPathComponent("Snapshots", isDirectory: true)
    let snapshots = try fileManager.contentsOfDirectory(at: snapshotsDirectory, includingPropertiesForKeys: nil)
    try expect(snapshots.count == 10, "snapshot history is capped at ten files")
    let latest = try store.load() as? [String: Any]
    try expect((latest?["version"] as? NSNumber)?.intValue == 12, "load latest local state")
    let stateURL = storeDirectory.appendingPathComponent("state.json")
    let stateAttributes = try fileManager.attributesOfItem(atPath: stateURL.path)
    try expect((stateAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "private state permissions")

    try Data("{corrompu".utf8).write(to: stateURL, options: .atomic)
    let recovered = try store.load() as? [String: Any]
    try expect(store.recoveredFromSnapshot, "corrupt state recovery flag")
    try expect((recovered?["version"] as? NSNumber)?.intValue == 11, "recover latest valid snapshot")
    let preservedCorruptFiles = try fileManager.contentsOfDirectory(at: storeDirectory, includingPropertiesForKeys: nil)
        .filter { $0.lastPathComponent.hasPrefix("state-corrompu-") }
    try expect(preservedCorruptFiles.count == 1, "preserve corrupt state for diagnosis")
    try store.save(["version": 13, "projects": [["id": "test", "title": "Version 13"]]])
    let prunedSnapshots = try fileManager.contentsOfDirectory(at: snapshotsDirectory, includingPropertiesForKeys: nil)
    try expect(prunedSnapshots.count == 10, "snapshot cap remains stable after recovery")

    print("AnalyseCoreChecks: 31 checks passed")
} catch {
    fputs("AnalyseCoreChecks failed: \(error)\n", stderr)
    exit(1)
}
