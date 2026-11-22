# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Product decisions

- The visual source of truth is the revised first concept: a premium dark macOS workspace with project rail, video and annotation tools on the left, and a Fountain/notes editor on the right.
- Subtitles are rendered as a readable banner directly over the video.
- A timecoded marker can contain a text note, a link, and frame annotations. Selecting it seeks the film and restores its note and annotations.
- Frame annotation tools include note, arrow, rectangle, and point marker.
- The Fountain editor offers contextual inline completion. The proposed suffix is shown in muted text and accepted with Tab.
- At compact macOS widths, transport controls and contextual menus must remain fully visible. Controls may wrap to a second row, and note/menu labels should wrap instead of being clipped with ellipses.
- Notes, Markdown, and Fountain editing surfaces use JetBrains Mono while the surrounding interface keeps its native sans-serif typography.
- The application opens on a project manager (launcher) before the workspace, like an editing suite: resume card for the last project, project grid with covers, search, sort, archives and project actions. There is no project rail in the workspace any more; a Home button in the top bar (and File › Projets, ⌘⇧P) returns to the launcher. The native window is compact on the launcher and restores the remembered workspace frame when a project opens.
- The product name is “Cinécrique”. Its title is “Analyse filmique, image par image” and its description is “L’atelier local pour analyser, annoter et réécrire films et séries.” The identity uses a framing-C mark with a playhead and timecoded marker.
- The bundled demonstration projects remain available as a guided local starting point and must stay compatible with persisted projects.
- Export is selective: script, Markdown analysis, timecoded notes, original video, subtitles, metadata, one annotated frame, all annotated frames, or the complete Cinécrique project. One item exports directly; multiple items form an organized archive.
- Transport controls, the timeline, the center divider, and the collapsed project rail must remain visually separated and usable at the minimum macOS window size.
- `Scénario` is exclusively Fountain with contextual Tab completion and whole-scene navigation; `Notes` remains exclusively Markdown.
- Professional transport includes persistent A/B looping, selectable playback speeds, J/K/L shuttle behavior, persistent mute, silent playback, and user-configurable single-key shortcuts.
- Timecode settings are project-specific and affect display only: automatic or manual common rates, offset, and 29.97 drop-frame support never move media-linked data.
- `Transcription` synchronizes imported subtitle cues and `Plans` derives editable shot rows directly from range markers without duplicating project data.
- Professional reports are selective local HTML/PDF exports, and image comparison stores only `{time, markerId}` references while regenerating frames and annotations on demand.
- Frame annotations are visible only on the exact captured media frame; they remain available from the timecoded marker history.
- Project covers can use a local image, a TMDB poster, the current frame, text, or the centered Cinécrique mark on black. Missing covers never receive a random image.
- Common video containers are accepted through one shared web/native policy, while actual playback remains codec-dependent and reports an explicit compatibility error.
- Non-native containers such as MKV use a local cached MP4 proxy: remux without quality loss whenever possible, transcode only incompatible tracks, keep all timecoded data in original media seconds, and always export the untouched original when video is selected.
- V1 release artifacts are built as a versioned DMG with a SHA-256 companion file and validated through `npm run release:check`.
- Cinécrique has two modes. The analysis workspace is untouched; a button in the top bar (never in the settings menu) switches the whole view to the extract studio and back. Both modes share one project, one set of timecoded markers and one source file.
- The extract studio cuts video extracts (MP4 or GIF) and still frames (PNG or JPEG) from the original media, never from the playback proxy, while stills are rendered from the playback media like every other frame export.
- The burned-in citation watermark is optional and switched off with one checkbox. Its text is rendered as an image by AppKit and composited by FFmpeg, so caller text never becomes part of a filter expression.
- A basket collects extracts before exporting: one item opens a save panel, several items ask for a destination folder.
- The interface fills the whole window, titlebar included, so the window is dragged through a dedicated transparent AppKit band (`WindowDragView`) laid over the web view — never through a hit test inside `WKWebView`, which forwards mouse events to the web content process. Its geometry lives in `WindowDragPolicy` and is verified on the shipped binary by `Cinecrique --check-window-drag`.
- Online videos (YouTube, Internet Archive and any site yt-dlp supports, including lesser-known streaming platforms) are downloaded to `~/Movies/Cinécrique` and then go through the normal local media pipeline. The page address is validated and always passed after `--`; DRM-protected services are not supported. yt-dlp is either the copy managed by Cinécrique (installed on request, checked against the release SHA-256) or a Homebrew copy.
- Notes can embed plans as Markdown lines `![Titre](cinecrique:plan/<markerId>?t=<s>)`. The embed stores only a marker reference; the frame and its annotations are regenerated from the marker, and annotating an embedded plan edits that marker's frame annotations.
- Plans are linked to the script with standard Fountain notes `[[plan:<markerId> …]]` inside the scene; the script text is the only source of the link. The Plans table exposes the linked scene, and the current scene's plans are listed under the script toolbar.
- Fountain files can be imported as a new project, appended, or replace the current script. Projects may exist without a video and attach one later (local or online).
- Automatic updates read a signed manifest (`cinecrique-update.json`, Ed25519 over version, size and SHA-256 of the DMG) from the latest GitHub release, verify the DMG and the code signature (same Team ID when present), then swap the bundle after the normal save-on-quit path and relaunch. The private key never enters the repository; without a configured public key the app only announces new versions.
