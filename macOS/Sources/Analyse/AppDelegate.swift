import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var webController: WebAppViewController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMainMenu()

        let controller = WebAppViewController()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        window.title = "Cinécrique"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .black
        window.minSize = NSSize(width: 960, height: 680)
        window.contentViewController = controller
        window.setFrameAutosaveName("Cinecrique.MainWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)

        self.webController = controller
        self.window = window

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        webController?.handleExternalFiles(urls)
    }

    @objc private func openVideo(_ sender: Any?) {
        webController?.dispatchEvent(named: "analyse:open-video-requested")
    }

    @objc private func openSubtitle(_ sender: Any?) {
        webController?.dispatchEvent(named: "analyse:open-subtitle-requested")
    }

    @objc private func saveProject(_ sender: Any?) {
        webController?.dispatchEvent(named: "analyse:save-requested")
    }

    @objc private func exportProject(_ sender: Any?) {
        webController?.dispatchEvent(named: "analyse:export-requested")
    }

    @objc private func reloadInterface(_ sender: Any?) {
        webController?.reload()
    }

    private func configureMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu(title: "Cinécrique")
        appMenu.addItem(withTitle: "À propos de Cinécrique", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Masquer Cinécrique", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quitter Cinécrique", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "Fichier")
        let openVideoItem = fileMenu.addItem(withTitle: "Ouvrir une vidéo…", action: #selector(openVideo(_:)), keyEquivalent: "o")
        openVideoItem.target = self
        let openSubtitleItem = fileMenu.addItem(withTitle: "Ouvrir des sous-titres…", action: #selector(openSubtitle(_:)), keyEquivalent: "o")
        openSubtitleItem.keyEquivalentModifierMask = [.command, .shift]
        openSubtitleItem.target = self
        fileMenu.addItem(.separator())
        let saveItem = fileMenu.addItem(withTitle: "Enregistrer", action: #selector(saveProject(_:)), keyEquivalent: "s")
        saveItem.target = self
        let exportItem = fileMenu.addItem(withTitle: "Exporter le projet…", action: #selector(exportProject(_:)), keyEquivalent: "e")
        exportItem.keyEquivalentModifierMask = [.command, .shift]
        exportItem.target = self
        fileMenuItem.submenu = fileMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "Présentation")
        let reloadItem = viewMenu.addItem(withTitle: "Recharger l’interface", action: #selector(reloadInterface(_:)), keyEquivalent: "r")
        reloadItem.target = self
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Plein écran", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }
}
