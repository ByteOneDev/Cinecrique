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
    do {
        _ = try ProjectArchivePolicy.validatedEntries(["Previews/café.png", "Previews/cafe\u{301}.png"])
        throw CheckError.failed("Unicode-normalized archive collision should throw")
    } catch ProjectArchiveError.duplicateEntry {
        // Expected.
    }
    do {
        _ = try ProjectArchivePolicy.validatedEntries(
            (0...ProjectArchivePolicy.maxEntries).map { "Frames/\($0).png" }
        )
        throw CheckError.failed("archive with too many entries should throw")
    } catch ProjectArchiveError.invalidEntryCount {
        // Expected.
    }
    do {
        let listing = ProjectArchiveListingAccumulator()
        try listing.append(Data(repeating: 0x61, count: ProjectArchivePolicy.maxEntryNameBytes + 2))
        throw CheckError.failed("oversized listing line should stop immediately")
    } catch ProjectArchiveError.unsafeEntry {
        // Expected.
    }
    do {
        let listing = ProjectArchiveListingAccumulator()
        let status = try BoundedProcessRunner.streamStandardOutput(
            executableURL: URL(fileURLWithPath: "/usr/bin/yes"),
            arguments: ["frame.png"],
            timeout: 3
        ) { try listing.append($0) }
        _ = status
        throw CheckError.failed("streaming listing should stop after the entry cap")
    } catch ProjectArchiveError.invalidEntryCount {
        // Expected.
    }
    do {
        _ = try BoundedProcessRunner.streamStandardOutput(
            executableURL: URL(fileURLWithPath: "/bin/sleep"),
            arguments: ["2"],
            timeout: 0.05
        ) { _ in }
        throw CheckError.failed("bounded process should time out")
    } catch BoundedProcessError.timedOut {
        // Expected.
    }
    try expect(
        ProjectArchivePolicy.expandedByteLimit(compressedBytes: 1_024) == 64 * 1_024 * 1_024,
        "archive expansion allowance has a bounded minimum"
    )
    do {
        try ProjectArchivePolicy.validateExpansion(
            compressedBytes: 1 * 1_024 * 1_024,
            expandedBytes: 300 * 1_024 * 1_024
        )
        throw CheckError.failed("strongly compressed archive should be rejected")
    } catch ProjectArchiveError.expandedDataTooLarge {
        // Expected.
    }
    try expect(
        StorageCapacityPolicy.hasSufficientSpace(availableBytes: 2_000_000_000, payloadBytes: 1_000_000_000),
        "disk preflight accepts sufficient capacity"
    )
    try expect(
        !StorageCapacityPolicy.hasSufficientSpace(availableBytes: 1_000_000_000, payloadBytes: 1_000_000_000),
        "disk preflight includes overhead and reserve"
    )
    try FrameAccuracyPolicy.validate(requestedSeconds: 10, actualSeconds: 10 + 0.01, frameRate: 24)
    do {
        try FrameAccuracyPolicy.validate(requestedSeconds: 10, actualSeconds: 10.1, frameRate: 24)
        throw CheckError.failed("neighbor frame drift should throw")
    } catch FrameAccuracyError.inexactFrame {
        // Expected.
    }
    try expect(
        ProjectArchivePolicy.portableMediaFileName(for: "Un film à Marseille.MP4") == "media.mp4",
        "portable media names remain ASCII and preserve the extension"
    )
    try expect(
        ProjectArchivePolicy.portableMediaFileName(for: "film.🎞") == "media",
        "portable media names reject unsafe extensions"
    )
    try expect(MediaFormatPolicy.acceptsVideoExtension("MKV"), "accept common MKV containers")
    try expect(MediaFormatPolicy.acceptsVideoExtension("mxf"), "accept professional MXF containers")
    try expect(MediaFormatPolicy.acceptsVideoExtension("vob"), "accept legacy DVD video containers")
    try expect(!MediaFormatPolicy.acceptsVideoExtension("exe"), "reject non-video extensions")
    try expect(
        !MediaToolPolicy.allowsExternalDevelopmentFallback(isDebug: false, environmentValue: "1"),
        "release builds never use external media tools"
    )
    try expect(
        MediaToolPolicy.allowsExternalDevelopmentFallback(isDebug: true, environmentValue: "1"),
        "external media tools require an explicit development opt-in"
    )

    try PersistedStatePolicy.validate([
        "version": 6,
        "projects": [["id": "film"]],
        "documents": ["film": ["markers": [], "annotationsByMarker": [:], "subtitleCues": []]],
    ])
    do {
        try PersistedStatePolicy.validate([
            "version": 6,
            "projects": [],
            "documents": [:],
            "__proto__": ["polluted": true],
        ])
        throw CheckError.failed("prototype-polluting keys should throw")
    } catch PersistedStateError.unsafeKey {
        // Expected.
    }
    do {
        try PersistedStatePolicy.validate([
            "version": 6,
            "projects": [["id": "film"]],
            "documents": ["film": [
                "markers": [],
                "annotationsByMarker": ["1": [[
                    "type": "pencil",
                    "points": Array(repeating: ["x": 0.5, "y": 0.5], count: PersistedStatePolicy.maxPencilPoints + 1),
                ]]],
            ]],
        ])
        throw CheckError.failed("oversized pencil stroke should throw")
    } catch PersistedStateError.tooManyPencilPoints {
        // Expected.
    }

    let mkvRemux = MediaProxyPolicy.decision(
        fileExtension: "mkv",
        videoCodec: "h264",
        audioCodecs: ["aac"]
    )
    try expect(mkvRemux.requiresProxy && mkvRemux.mode == .remux, "remux compatible MKV streams")
    let mkvAudioProxy = MediaProxyPolicy.decision(
        fileExtension: "mkv",
        videoCodec: "hevc",
        audioCodecs: ["dts"]
    )
    try expect(mkvAudioProxy.mode == .transcodeAudio, "transcode only incompatible MKV audio")
    let mkvVideoProxy = MediaProxyPolicy.decision(
        fileExtension: "mkv",
        videoCodec: "vp9",
        audioCodecs: ["opus"]
    )
    try expect(mkvVideoProxy.mode == .transcodeVideo, "transcode incompatible MKV video")
    let nativeMP4 = MediaProxyPolicy.decision(
        fileExtension: "mp4",
        videoCodec: "h264",
        audioCodecs: ["aac"]
    )
    try expect(!nativeMP4.requiresProxy, "keep compatible MP4 direct")
    let forcedMP4 = MediaProxyPolicy.decision(
        fileExtension: "mp4",
        videoCodec: "h264",
        audioCodecs: ["aac"],
        forceProxy: true
    )
    try expect(forcedMP4.requiresProxy && forcedMP4.mode == .remux, "allow forced compatibility proxy")

    let reportHTML = ReportHTMLBuilder.build(model: [
        "title": "Film <script>alert(1)</script>",
        "projectInfo": [["label": "Cadence", "value": "24 i/s"]],
        "markers": [[
            "start": "00:00:01:00",
            "title": "Lien",
            "detail": "Texte <b>non fiable</b>",
            "url": "javascript:alert(1)",
        ]],
        "analysis": "# Analyse\n\n<script>alert(2)</script>",
    ])
    try expect(reportHTML.contains("Film &lt;script&gt;alert(1)&lt;/script&gt;"), "report escapes titles")
    try expect(reportHTML.contains("Texte &lt;b&gt;non fiable&lt;/b&gt;"), "report escapes marker content")
    try expect(!reportHTML.contains("href=\"javascript:"), "report rejects executable links")
    try expect(reportHTML.contains("Content-Security-Policy"), "report carries an offline CSP")

    let allowedReportLink = ReportHTMLBuilder.build(model: [
        "title": "Film",
        "markers": [["start": "00:00:01:00", "title": "Source", "url": "https://example.com/page"]],
    ])
    try expect(allowedReportLink.contains("href=\"https://example.com/page\""), "report allows HTTP(S) links")

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

    let restorePoint = try store.createRestorableSnapshot()
    try expect(restorePoint != nil, "explicit replacement snapshot is created")
    try store.save(["version": 14, "projects": [["id": "replacement", "title": "Replacement"]]])
    let restored = try store.restoreSnapshot(named: restorePoint!) as? [String: Any]
    try expect((restored?["version"] as? NSNumber)?.intValue == 13, "explicit snapshot can restore replaced state")

    let unsafeStoreDirectory = fileManager.temporaryDirectory
        .appendingPathComponent("Cinecrique-UnsafeSnapshots-\(UUID().uuidString)", isDirectory: true)
    let redirectedDirectory = fileManager.temporaryDirectory
        .appendingPathComponent("Cinecrique-RedirectedSnapshots-\(UUID().uuidString)", isDirectory: true)
    defer {
        try? fileManager.removeItem(at: unsafeStoreDirectory)
        try? fileManager.removeItem(at: redirectedDirectory)
    }
    try fileManager.createDirectory(at: unsafeStoreDirectory, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: redirectedDirectory, withIntermediateDirectories: true)
    try fileManager.createSymbolicLink(
        at: unsafeStoreDirectory.appendingPathComponent("Snapshots"),
        withDestinationURL: redirectedDirectory
    )
    do {
        _ = try AppStateStore(testDirectory: unsafeStoreDirectory)
        throw CheckError.failed("symlinked snapshots directory should throw")
    } catch {
        try expect(error.localizedDescription.contains("pas sûr"), "unsafe snapshots directory is rejected")
    }

    print("AnalyseCoreChecks: extended checks passed")
} catch {
    fputs("AnalyseCoreChecks failed: \(error)\n", stderr)
    exit(1)
}
