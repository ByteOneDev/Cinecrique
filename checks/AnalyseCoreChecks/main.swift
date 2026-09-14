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
    for optionLikeEntry in ["-x", "-d", "--help", "-P"] {
        do {
            _ = try ProjectArchivePolicy.validatedEntries(["manifest.json", optionLikeEntry])
            throw CheckError.failed("archive entry \(optionLikeEntry) should throw")
        } catch ProjectArchiveError.unsafeEntry {
            // Expected: unzip would read the entry name as one of its own switches.
        }
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

    // Window drag band.
    let standardWindow = CGSize(width: 1_440, height: 920)
    try expect(
        WindowDragPolicy.isDragPoint(CGPoint(x: 300, y: 20), inWindowSize: standardWindow),
        "the brand area drags the window"
    )
    try expect(
        !WindowDragPolicy.isDragPoint(CGPoint(x: 300, y: 900), inWindowSize: standardWindow),
        "the bottom of the window never drags it"
    )
    try expect(
        !WindowDragPolicy.isDragPoint(CGPoint(x: 30, y: 20), inWindowSize: standardWindow),
        "the traffic lights stay clickable"
    )
    try expect(
        !WindowDragPolicy.isDragPoint(CGPoint(x: 1_400, y: 20), inWindowSize: standardWindow),
        "the top bar controls stay clickable"
    )
    try expect(
        !WindowDragPolicy.isDragPoint(CGPoint(x: 300, y: WindowDragPolicy.bandHeight + 1), inWindowSize: standardWindow),
        "the band stops at its own height"
    )
    try expect(
        WindowDragPolicy.bandWidth(forWindowWidth: 960) > 0,
        "the band survives the minimum window width"
    )
    try expect(
        WindowDragPolicy.bandWidth(forWindowWidth: 500) == 0,
        "the band disappears rather than fight the controls"
    )
    try expect(
        WindowDragPolicy.bandRect(forWindowSize: CGSize(width: 500, height: 680)).isEmpty,
        "an unusable band yields an empty rect"
    )
    try expect(
        WindowDragPolicy.bandRect(forWindowSize: standardWindow)
            == CGRect(x: 76, y: 0, width: 1_440 - 76 - 430, height: WindowDragPolicy.bandHeight),
        "band geometry keeps both insets"
    )

    // Clip export policy.
    try expect(
        try ClipExportPolicy.validatedDuration(start: 10, end: 22, format: .mp4, mediaDuration: 600) == 12,
        "accepted clip duration"
    )
    do {
        _ = try ClipExportPolicy.validatedDuration(start: 10, end: 10, format: .mp4, mediaDuration: 600)
        throw CheckError.failed("empty clip range should throw")
    } catch ClipExportError.invalidRange {
        // Expected.
    }
    do {
        _ = try ClipExportPolicy.validatedDuration(start: 0, end: 700, format: .mp4, mediaDuration: 3_000)
        throw CheckError.failed("over-long clip should throw")
    } catch ClipExportError.rangeTooLong {
        // Expected.
    }
    do {
        _ = try ClipExportPolicy.validatedDuration(start: 0, end: 40, format: .gif, mediaDuration: 3_000)
        throw CheckError.failed("over-long GIF should throw")
    } catch ClipExportError.rangeTooLong {
        // Expected.
    }
    do {
        _ = try ClipExportPolicy.validatedDuration(start: 4_000, end: 4_010, format: .mp4, mediaDuration: 3_000)
        throw CheckError.failed("range outside the media should throw")
    } catch ClipExportError.rangeOutsideMedia {
        // Expected.
    }

    try expect(
        ClipExportPolicy.sanitizedFileName("../../etc/passwd", fallback: "extrait", fileExtension: "mp4") == "passwd.mp4",
        "export name drops traversal segments"
    )
    try expect(
        ClipExportPolicy.sanitizedFileName("...", fallback: "extrait", fileExtension: "mp4") == "extrait.mp4",
        "empty export name falls back"
    )
    try expect(
        ClipExportPolicy.sanitizedFileName("Le Mépris — plan 4", fallback: "extrait", fileExtension: "gif") == "LeMeprisplan4.gif",
        "export name keeps only portable characters"
    )
    try expect(
        ClipExportPolicy.sanitizedWatermarkLines(["  Citation  ", "", "a\u{0}b", String(repeating: "x", count: 400)])
            == ["Citation", "ab", String(repeating: "x", count: ClipExportPolicy.maxWatermarkLineCharacters)],
        "watermark lines are trimmed, stripped and capped"
    )
    try expect(
        ClipExportPolicy.sanitizedWatermarkLines(["a", "b", "c", "d"]).count == ClipExportPolicy.maxWatermarkLines,
        "watermark keeps at most three lines"
    )

    try expect(
        ClipExportPolicy.outputSize(sourceWidth: 1_920, sourceHeight: 1_080, rotationDegrees: 0, maxHeight: 720, format: .mp4)
            == ClipFrameSize(width: 1_280, height: 720),
        "downscale keeps the aspect ratio on even pixels"
    )
    try expect(
        ClipExportPolicy.outputSize(sourceWidth: 1_920, sourceHeight: 1_080, rotationDegrees: 90, maxHeight: 0, format: .mp4)
            == ClipFrameSize(width: 1_080, height: 1_920),
        "rotated sources swap their dimensions"
    )
    try expect(
        ClipExportPolicy.outputSize(sourceWidth: 1_920, sourceHeight: 1_080, rotationDegrees: 0, maxHeight: 1_080, format: .gif).height
            <= ClipExportPolicy.maxGifHeight,
        "GIF output stays within its own ceiling"
    )
    try expect(
        ClipExportPolicy.outputSize(sourceWidth: 1_999, sourceHeight: 1_081, rotationDegrees: 0, maxHeight: 0, format: .mp4).width % 2 == 0,
        "odd source widths are rounded to an even value"
    )

    try expect(
        ClipExportPolicy.videoBitrate(size: ClipFrameSize(width: 1_280, height: 720), frameRate: 25, quality: .standard)
            > ClipExportPolicy.videoBitrate(size: ClipFrameSize(width: 1_280, height: 720), frameRate: 25, quality: .light),
        "higher quality raises the bitrate"
    )
    try expect(
        ClipExportPolicy.videoBitrate(size: ClipFrameSize(width: 2, height: 2), frameRate: 1, quality: .light)
            == ClipExportPolicy.minimumVideoBitrate,
        "bitrate never falls below the floor"
    )
    try expect(
        ClipExportPolicy.videoBitrate(size: ClipFrameSize(width: 7_680, height: 4_320), frameRate: 60, quality: .high)
            == ClipExportPolicy.maximumVideoBitrate,
        "bitrate never exceeds the ceiling"
    )

    try expect(
        ClipExportPolicy.resolvedMode(
            requested: .copy,
            format: .mp4,
            containerExtension: "mkv",
            videoCodec: "h264",
            audioCodecs: ["aac"],
            includeAudio: true,
            watermarked: false,
            scaled: false
        ) == .copy,
        "compatible tracks allow a direct copy"
    )
    try expect(
        ClipExportPolicy.resolvedMode(
            requested: .copy,
            format: .mp4,
            containerExtension: "mkv",
            videoCodec: "h264",
            audioCodecs: ["aac"],
            includeAudio: true,
            watermarked: true,
            scaled: false
        ) == .accurate,
        "a burned-in watermark always forces a re-encode"
    )
    try expect(
        ClipExportPolicy.resolvedMode(
            requested: .copy,
            format: .mp4,
            containerExtension: "mov",
            videoCodec: "prores",
            audioCodecs: ["pcm_s16le"],
            includeAudio: true,
            watermarked: false,
            scaled: false
        ) == .accurate,
        "non-copyable codecs fall back to a re-encode"
    )
    try expect(
        ClipExportPolicy.resolvedMode(
            requested: .copy,
            format: .gif,
            containerExtension: "mp4",
            videoCodec: "h264",
            audioCodecs: [],
            includeAudio: false,
            watermarked: false,
            scaled: false
        ) == .accurate,
        "GIF never uses a direct copy"
    )

    let watermark = ClipWatermark(lines: ["« Citation »"], position: .bottomLeft, size: .medium, opacity: 0.9)
    let clipRequest = ClipRequest(
        kind: .clip,
        start: 12.5,
        end: 20.5,
        format: .mp4,
        maxHeight: 720,
        quality: .standard,
        mode: .accurate,
        includeAudio: true,
        frameRate: 0,
        name: "extrait.mp4",
        watermark: watermark
    )
    let encodeArguments = ClipExportPolicy.arguments(
        inputPath: "/films/source.mkv",
        watermarkImagePath: "/tmp/watermark.png",
        outputPath: "/exports/extrait.mp4",
        request: clipRequest,
        duration: 8,
        size: ClipFrameSize(width: 1_280, height: 720),
        sourceSize: ClipFrameSize(width: 1_920, height: 1_080),
        sourceFrameRate: 25,
        mode: .accurate
    )
    try expect(encodeArguments.last == "/exports/extrait.mp4", "output path closes the argument vector")
    try expect(encodeArguments.contains("12.500") && encodeArguments.contains("8.000"), "seek and duration are explicit")
    try expect(encodeArguments.contains("h264_videotoolbox"), "accurate mode re-encodes the picture")
    try expect(
        encodeArguments.contains("[0:v]scale=1280:720:flags=lanczos[base];[base][1:v]overlay=0:0:format=auto[out]"),
        "the watermark is overlaid as a pre-rendered image"
    )
    try expect(
        encodeArguments.allSatisfy { !$0.contains("« Citation »") },
        "watermark text never reaches the command line"
    )

    let copyRequest = ClipRequest(
        kind: .clip,
        start: 0,
        end: 5,
        format: .mp4,
        maxHeight: 0,
        quality: .standard,
        mode: .copy,
        includeAudio: false,
        frameRate: 0,
        name: "extrait.mp4",
        watermark: nil
    )
    let copyArguments = ClipExportPolicy.arguments(
        inputPath: "/films/source.mp4",
        watermarkImagePath: nil,
        outputPath: "/exports/extrait.mp4",
        request: copyRequest,
        duration: 5,
        size: ClipFrameSize(width: 1_920, height: 1_080),
        sourceSize: ClipFrameSize(width: 1_920, height: 1_080),
        sourceFrameRate: 25,
        mode: .copy
    )
    try expect(copyArguments.contains("copy") && copyArguments.contains("-an"), "copy mode streams without audio when muted")
    try expect(!copyArguments.contains("h264_videotoolbox"), "copy mode never re-encodes")

    let gifRequest = ClipRequest(
        kind: .clip,
        start: 3,
        end: 8,
        format: .gif,
        maxHeight: 480,
        quality: .standard,
        mode: .accurate,
        includeAudio: false,
        frameRate: 12,
        name: "extrait.gif",
        watermark: nil
    )
    let gifArguments = ClipExportPolicy.arguments(
        inputPath: "/films/source.mp4",
        watermarkImagePath: nil,
        outputPath: "/exports/extrait.gif",
        request: gifRequest,
        duration: 5,
        size: ClipFrameSize(width: 852, height: 480),
        sourceSize: ClipFrameSize(width: 1_920, height: 1_080),
        sourceFrameRate: 25,
        mode: .accurate
    )
    try expect(
        gifArguments.contains { $0.contains("palettegen") && $0.contains("paletteuse") && $0.contains("fps=12") },
        "GIF export builds its own palette"
    )
    try expect(gifArguments.contains("-an"), "GIF export drops the audio track")

    try expect(
        ClipExportPolicy.watermarkMetrics(frameHeight: 1_080, size: .large).fontSize
            > ClipExportPolicy.watermarkMetrics(frameHeight: 1_080, size: .small).fontSize,
        "watermark size scales the type"
    )
    try expect(
        ClipExportPolicy.watermarkMetrics(frameHeight: 10, size: .medium).fontSize >= 11,
        "watermark stays legible on tiny frames"
    )

    print("AnalyseCoreChecks: extended checks passed")
} catch {
    fputs("AnalyseCoreChecks failed: \(error)\n", stderr)
    exit(1)
}
