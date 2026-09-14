import AppKit
import AnalyseCore

/// Transparent band laid over the top of the web view so the window can be
/// dragged by its brand area.
///
/// The band is a real AppKit view rather than a hit test inside the web view:
/// `WKWebView` forwards mouse events to the web content process, so a drag
/// started there is unreliable. A sibling view above it receives the event
/// first and hands it straight to the window.
final class WindowDragView: NSView {
    /// Lays the band over `sibling`, inside `container`. Kept as a single entry
    /// point so the shipped binary can verify the resulting geometry through
    /// `--check-window-drag`.
    @discardableResult
    static func install(in container: NSView, above sibling: NSView) -> WindowDragView {
        let band = WindowDragView()
        band.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(band, positioned: .above, relativeTo: sibling)

        let trailing = band.trailingAnchor.constraint(
            equalTo: container.trailingAnchor,
            constant: -WindowDragPolicy.trailingInset
        )
        trailing.priority = .defaultHigh

        NSLayoutConstraint.activate([
            band.topAnchor.constraint(equalTo: container.topAnchor),
            band.leadingAnchor.constraint(
                equalTo: container.leadingAnchor,
                constant: WindowDragPolicy.leadingInset
            ),
            trailing,
            band.widthAnchor.constraint(greaterThanOrEqualToConstant: 0),
            band.heightAnchor.constraint(equalToConstant: WindowDragPolicy.bandHeight)
        ])
        return band
    }

    override var mouseDownCanMoveWindow: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        guard let window else {
            super.mouseDown(with: event)
            return
        }
        if event.clickCount == 2 {
            Self.performDoubleClickAction(on: window)
            return
        }
        window.performDrag(with: event)
    }

    override func resetCursorRects() {
        discardCursorRects()
        addCursorRect(bounds, cursor: .arrow)
    }

    /// Mirrors the “Double-click a window’s title bar to” system setting.
    private static func performDoubleClickAction(on window: NSWindow) {
        let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
        switch action {
        case "Minimize":
            window.miniaturize(nil)
        case "None":
            break
        default:
            window.zoom(nil)
        }
    }
}
