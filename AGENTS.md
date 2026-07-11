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
- The project rail can collapse into a compact icon-and-poster strip, and its state persists between launches independently of the workspace split position.
- The product name is “Cinécrique”. Its title is “Analyse filmique, image par image” and its description is “L’atelier local pour analyser, annoter et réécrire films et séries.” The identity uses a framing-C mark with a playhead and timecoded marker.
- The bundled demonstration projects remain available as a guided local starting point and must stay compatible with persisted projects.
- Export is selective: script, Markdown analysis, timecoded notes, original video, subtitles, metadata, one annotated frame, all annotated frames, or the complete Cinécrique project. One item exports directly; multiple items form an organized archive.
- Transport controls, the timeline, the center divider, and the collapsed project rail must remain visually separated and usable at the minimum macOS window size.
