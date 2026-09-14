import AppKit
import WebKit

/// Web view hosting the interface. Window dragging is handled by `WindowDragView`,
/// laid over the top of this view: `WKWebView` forwards mouse events to the web
/// content process, which makes a drag started here unreliable.
final class DropWebView: WKWebView {
    var onFileDrop: (([URL]) -> Void)?

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.fileURL])
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        droppedURLs(from: sender).isEmpty ? super.draggingEntered(sender) : .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = droppedURLs(from: sender)
        guard !urls.isEmpty else { return super.performDragOperation(sender) }
        onFileDrop?(urls)
        return true
    }

    private func droppedURLs(from sender: NSDraggingInfo) -> [URL] {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        return sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] ?? []
    }
}
