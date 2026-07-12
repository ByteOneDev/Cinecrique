import Foundation

public struct ReportImage: Equatable {
    public let title: String
    public let timecode: String
    public let dataURL: String

    public init(title: String, timecode: String, dataURL: String) {
        self.title = title
        self.timecode = timecode
        self.dataURL = dataURL
    }
}

public enum ReportHTMLBuilder {
    public static func build(model: [String: Any], images: [ReportImage] = []) -> String {
        let title = string(model["title"], maximum: 500, fallback: "Projet Cinécrique")
        let subtitle = string(model["subtitle"], maximum: 500)
        let generatedAt = formattedDate(string(model["generatedAt"], maximum: 100))
        let information = dictionaries(model["projectInfo"], maximum: 100)
        let markers = dictionaries(model["markers"], maximum: 5_000)
        let shots = dictionaries(model["shots"], maximum: 5_000)
        let analysis = string(model["analysis"], maximum: 2_000_000)
        let scenes = dictionaries(model["scenes"], maximum: 500)
        let reportImages = images.prefix(100).filter { $0.dataURL.hasPrefix("data:image/png;base64,") }

        var sections: [String] = []
        if !information.isEmpty { sections.append(informationSection(information)) }
        if !markers.isEmpty { sections.append(markersSection(markers)) }
        if !reportImages.isEmpty { sections.append(imagesSection(Array(reportImages))) }
        if !shots.isEmpty { sections.append(shotsSection(shots)) }
        if !analysis.isEmpty { sections.append(analysisSection(analysis)) }
        if !scenes.isEmpty { sections.append(scenesSection(scenes)) }

        return """
        <!doctype html>
        <html lang="fr">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
          <title>\(escape(title)) — Rapport Cinécrique</title>
          <style>\(stylesheet)</style>
        </head>
        <body>
          <header class="cover">
            <div class="brand">CINÉCRIQUE · RAPPORT D’ANALYSE</div>
            <h1>\(escape(title))</h1>
            \(subtitle.isEmpty ? "" : "<p class=\"subtitle\">\(escape(subtitle))</p>")
            <p class="generated">Généré localement\(generatedAt.isEmpty ? "" : " · \(escape(generatedAt))")</p>
          </header>
          <main>\(sections.joined(separator: "\n"))</main>
          <footer>Cinécrique · Analyse filmique, image par image</footer>
        </body>
        </html>
        """
    }

    private static func informationSection(_ rows: [[String: Any]]) -> String {
        let content = rows.map { row in
            "<div><dt>\(escape(string(row["label"], maximum: 200)))</dt><dd>\(escape(string(row["value"], maximum: 2_000)))</dd></div>"
        }.joined()
        return section("Informations du projet", "<dl class=\"information\">\(content)</dl>")
    }

    private static func markersSection(_ markers: [[String: Any]]) -> String {
        let content = markers.map { marker in
            let start = string(marker["start"], maximum: 100)
            let end = string(marker["end"], maximum: 100)
            let timecode = end.isEmpty ? start : "\(start) → \(end)"
            let title = string(marker["title"], maximum: 500, fallback: "Repère")
            let detail = string(marker["detail"], maximum: 20_000)
            let type = string(marker["type"], maximum: 100)
            let tag = string(marker["tag"], maximum: 200)
            let bookmarked = (marker["bookmarked"] as? Bool) == true ? " · Signet" : ""
            let metadata = [type, tag].filter { !$0.isEmpty }.map(escape).joined(separator: " · ") + bookmarked
            let link = safeLink(string(marker["url"], maximum: 4_096))
            return """
            <article class="marker">
              <div class="timecode">\(escape(timecode))</div>
              <div><h3>\(escape(title))</h3>\(metadata.isEmpty ? "" : "<p class=\"meta\">\(metadata)</p>")\(detail.isEmpty ? "" : "<p>\(lineBreaks(detail))</p>")\(link)</div>
            </article>
            """
        }.joined()
        return section("Notes et repères timecodés", content)
    }

    private static func imagesSection(_ images: [ReportImage]) -> String {
        let content = images.map { image in
            """
            <figure>
              <img src="\(escapeAttribute(image.dataURL))" alt="Image annotée à \(escapeAttribute(image.timecode))">
              <figcaption><span>\(escape(image.timecode))</span>\(escape(image.title))</figcaption>
            </figure>
            """
        }.joined()
        return section("Images annotées", "<div class=\"image-grid\">\(content)</div>")
    }

    private static func shotsSection(_ shots: [[String: Any]]) -> String {
        let headings = ["Début", "Fin", "Durée", "Titre", "Type", "Mouvement", "Personnages", "Son", "Tag", "Commentaire"]
        let keys = ["start", "end", "duration", "title", "shotType", "movement", "characters", "sound", "tag", "comment"]
        let header = headings.map { "<th>\(escape($0))</th>" }.joined()
        let body = shots.map { shot in
            "<tr>\(keys.map { "<td>\(lineBreaks(string(shot[$0], maximum: 20_000)))</td>" }.joined())</tr>"
        }.joined()
        return section("Tableau des plans", "<div class=\"table-wrap\"><table><thead><tr>\(header)</tr></thead><tbody>\(body)</tbody></table></div>")
    }

    private static func analysisSection(_ value: String) -> String {
        section("Analyse", "<div class=\"markdown\">\(renderMarkdown(value))</div>")
    }

    private static func scenesSection(_ scenes: [[String: Any]]) -> String {
        let content = scenes.map { scene in
            let heading = string(scene["heading"], maximum: 500, fallback: "Scène")
            let source = string(scene["content"], maximum: 2_000_000)
            return "<article class=\"scene\"><h3>\(escape(heading))</h3><pre>\(escape(source))</pre></article>"
        }.joined()
        return section("Extraits du scénario", content)
    }

    private static func section(_ title: String, _ content: String) -> String {
        "<section><h2>\(escape(title))</h2>\(content)</section>"
    }

    private static func renderMarkdown(_ value: String) -> String {
        var output: [String] = []
        var listOpen = false
        for rawLine in value.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("- ") || line.hasPrefix("* ") {
                if !listOpen { output.append("<ul>"); listOpen = true }
                output.append("<li>\(escape(String(line.dropFirst(2))))</li>")
                continue
            }
            if listOpen { output.append("</ul>"); listOpen = false }
            if line.isEmpty { continue }
            let hashCount = min(line.prefix { $0 == "#" }.count, 4)
            if hashCount > 0, line.dropFirst(hashCount).first == " " {
                let level = min(hashCount + 2, 6)
                output.append("<h\(level)>\(escape(String(line.dropFirst(hashCount + 1))))</h\(level)>")
            } else {
                output.append("<p>\(escape(line))</p>")
            }
        }
        if listOpen { output.append("</ul>") }
        return output.joined()
    }

    private static func safeLink(_ value: String) -> String {
        guard let url = URL(string: value), AppURLPolicy.isAllowedExternalURL(url) else { return "" }
        return "<p><a href=\"\(escapeAttribute(url.absoluteString))\">Ouvrir le lien</a></p>"
    }

    private static func lineBreaks(_ value: String) -> String {
        escape(value).replacingOccurrences(of: "\n", with: "<br>")
    }

    private static func dictionaries(_ value: Any?, maximum: Int) -> [[String: Any]] {
        Array((value as? [[String: Any]] ?? []).prefix(maximum))
    }

    private static func string(_ value: Any?, maximum: Int, fallback: String = "") -> String {
        let candidate = value as? String ?? fallback
        return String(candidate.prefix(maximum))
    }

    private static func formattedDate(_ value: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: value) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateStyle = .long
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private static func escapeAttribute(_ value: String) -> String { escape(value) }

    private static let stylesheet = """
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: #171a1c; background: #fff; }
    * { box-sizing: border-box; }
    body { max-width: 1180px; margin: 0 auto; padding: 56px; font-size: 13px; line-height: 1.55; }
    .cover { min-height: 280px; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 34px; border-bottom: 2px solid #c99532; }
    .brand { margin-bottom: 24px; color: #8b661f; font-size: 11px; font-weight: 700; letter-spacing: .12em; }
    h1 { max-width: 760px; margin: 0; font-size: 42px; line-height: 1.08; }
    .subtitle { margin: 12px 0 0; color: #50575a; font-size: 18px; }
    .generated { margin-top: 28px; color: #777e81; font-size: 11px; }
    section { margin-top: 42px; break-inside: avoid-page; }
    section > h2 { margin: 0 0 18px; padding-bottom: 7px; border-bottom: 1px solid #c9cecf; font-size: 20px; }
    h3 { margin: 0; font-size: 14px; }
    p { margin: 7px 0; }
    .information { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; margin: 0; }
    .information div { display: grid; grid-template-columns: 120px 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px solid #e4e7e8; }
    dt { color: #676f72; } dd { margin: 0; font-weight: 550; }
    .marker { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; padding: 16px 0; border-bottom: 1px solid #e3e6e7; break-inside: avoid; }
    .timecode, figcaption span { color: #9a6e1e; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .meta { color: #737b7e; font-size: 11px; }
    a { color: #7e5818; }
    .image-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
    figure { margin: 0; break-inside: avoid; } img { width: 100%; display: block; border: 1px solid #cbd0d1; }
    figcaption { display: grid; grid-template-columns: auto 1fr; gap: 12px; margin-top: 7px; color: #41474a; }
    .table-wrap { overflow: hidden; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
    th { padding: 6px; color: #fff; background: #202629; text-align: left; }
    td { padding: 6px; border-bottom: 1px solid #dfe3e4; vertical-align: top; overflow-wrap: anywhere; }
    .markdown { max-width: 760px; } .markdown h3, .markdown h4, .markdown h5, .markdown h6 { margin: 22px 0 7px; }
    .scene { margin: 0 0 28px; break-inside: avoid-page; }
    pre { margin: 10px 0 0; padding: 18px; white-space: pre-wrap; overflow-wrap: anywhere; background: #f2f3f3; border-left: 3px solid #c99532; font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
    footer { margin-top: 52px; padding-top: 12px; color: #767d80; border-top: 1px solid #d8dcdd; font-size: 10px; }
    @page { size: A4 landscape; margin: 14mm; }
    @media print { body { max-width: none; padding: 0; } .cover { min-height: 160mm; break-after: page; } section { break-inside: auto; } a { color: inherit; text-decoration: none; } }
    """
}

