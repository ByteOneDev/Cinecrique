import AppKit

/// The window opens on the project manager at a compact size, like the project
/// window of an editing suite, and grows to the remembered workspace frame
/// when a project is opened. Coming back to the project list remembers the
/// workspace frame again. Nothing changes while the window is in full screen.
enum WindowMode: String {
    case launcher
    case workspace
}

final class WindowModeController {
    static let shared = WindowModeController()
    static let workspaceFrameName = "Cinecrique.MainWindow"

    private(set) var mode: WindowMode = .launcher

    static func launcherFrame(on screen: NSScreen?) -> NSRect {
        let visible = (screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1_280, height: 800)
        let width = min(1_120, max(960, visible.width - 80))
        let height = min(740, max(680, visible.height - 80))
        return NSRect(
            x: visible.midX - width / 2,
            y: visible.midY - height / 2,
            width: width,
            height: height
        ).integral
    }

    func apply(_ next: WindowMode, to window: NSWindow) {
        guard next != mode else { return }
        let previous = mode
        mode = next
        guard !window.styleMask.contains(.fullScreen) else { return }

        switch next {
        case .launcher:
            if previous == .workspace { window.saveFrame(usingName: Self.workspaceFrameName) }
            window.setFrame(Self.launcherFrame(on: window.screen), display: true, animate: true)
        case .workspace:
            let launcherFrame = window.frame
            if !window.setFrameUsingName(Self.workspaceFrameName) {
                let visible = (window.screen ?? NSScreen.main)?.visibleFrame ?? launcherFrame
                let width = min(1_440, visible.width - 40)
                let height = min(920, visible.height - 40)
                window.setFrame(
                    NSRect(x: visible.midX - width / 2, y: visible.midY - height / 2, width: width, height: height).integral,
                    display: true
                )
            }
            let target = window.frame
            window.setFrame(launcherFrame, display: false)
            window.setFrame(target, display: true, animate: true)
        }
    }

    /// Called when the window closes or the application quits.
    func rememberWorkspaceFrame(of window: NSWindow) {
        guard mode == .workspace, !window.styleMask.contains(.fullScreen) else { return }
        window.saveFrame(usingName: Self.workspaceFrameName)
    }
}
