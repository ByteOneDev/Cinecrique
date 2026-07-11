import AppKit
import WebKit

final class DropWebView: WKWebView {
    var onFileDrop: (([URL]) -> Void)?

    private let titlebarHeight: CGFloat = 55
    private let titlebarLeadingInset: CGFloat = 76
    private let titlebarControlsWidth: CGFloat = 430

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.fileURL])
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let maximumDragX = max(titlebarLeadingInset, bounds.width - titlebarControlsWidth)
        let isInTitlebar = point.y >= bounds.height - titlebarHeight
            && point.x >= titlebarLeadingInset
            && point.x <= maximumDragX

        guard isInTitlebar, let window else {
            super.mouseDown(with: event)
            return
        }
        if event.clickCount == 2 {
            window.zoom(nil)
        } else {
            window.performDrag(with: event)
        }
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
