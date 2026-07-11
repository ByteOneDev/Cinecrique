import AppKit
import WebKit
import AnalyseCore

final class WebAppViewController: NSViewController, WKNavigationDelegate {
    private let bridge: NativeBridge
    private let mediaHandler: LocalMediaSchemeHandler
    private let appHandler: BundledAppSchemeHandler
    private let weakMessageHandler: WeakScriptMessageHandler
    private(set) var webView: DropWebView
    private var isReady = false
    private var pendingFiles: [URL] = []

    init() {
        let bridge = NativeBridge()
        let mediaHandler = LocalMediaSchemeHandler()
        let appHandler = BundledAppSchemeHandler()
        let configuration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        let weakMessageHandler = WeakScriptMessageHandler(delegate: bridge)

        contentController.add(weakMessageHandler, name: NativeBridge.messageName)
        contentController.addUserScript(WKUserScript(
            source: NativeBridge.injectedScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        configuration.userContentController = contentController
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.preferences.isElementFullscreenEnabled = true
        configuration.setURLSchemeHandler(appHandler, forURLScheme: "analyse-app")
        configuration.setURLSchemeHandler(mediaHandler, forURLScheme: "analyse-media")

        let webView = DropWebView(frame: .zero, configuration: configuration)
        self.bridge = bridge
        self.mediaHandler = mediaHandler
        self.appHandler = appHandler
        self.weakMessageHandler = weakMessageHandler
        self.webView = webView

        super.init(nibName: nil, bundle: nil)

        bridge.webView = webView
        bridge.onFrontendReady = { [weak self] in
            self?.markFrontendReady()
        }
        webView.navigationDelegate = self
        webView.allowsMagnification = false
        webView.allowsLinkPreview = false
        webView.underPageBackgroundColor = .black
        webView.onFileDrop = { [weak self] urls in
            self?.handleExternalFiles(urls)
        }
    }

    required init?(coder: NSCoder) {
        nil
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: NativeBridge.messageName)
    }

    override func loadView() {
        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor

        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadBundledApp()
    }

    func reload() {
        isReady = false
        webView.reload()
    }

    func dispatchEvent(named name: String) {
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent(name));",
            arguments: ["name": name],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    func handleExternalFiles(_ urls: [URL]) {
        guard isReady else {
            pendingFiles.append(contentsOf: urls)
            return
        }
        bridge.handleExternalFiles(urls)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url, AppURLPolicy.isTrustedAppURL(url) else {
            isReady = false
            return
        }
        webView.evaluateJavaScript(
            "window.__ANALYSE_NATIVE_READY__ = true; window.dispatchEvent(new CustomEvent('analyse:native-ready'));"
        )
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isReady = false
    }

    private func markFrontendReady() {
        guard let url = webView.url, AppURLPolicy.isTrustedAppURL(url) else { return }
        isReady = true
        if !pendingFiles.isEmpty {
            let files = pendingFiles
            pendingFiles.removeAll()
            bridge.handleExternalFiles(files)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if AppURLPolicy.isTrustedAppURL(url) {
            decisionHandler(.allow)
            return
        }
        if navigationAction.navigationType == .linkActivated, AppURLPolicy.isAllowedExternalURL(url) {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        guard
            let url = navigationResponse.response.url,
            AppURLPolicy.isTrustedAppURL(url),
            navigationResponse.canShowMIMEType
        else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func loadBundledApp() {
        guard let resources = Bundle.main.resourceURL?.appendingPathComponent("WebApp", isDirectory: true),
              FileManager.default.fileExists(atPath: resources.appendingPathComponent("index.html").path),
              let appURL = URL(string: "analyse-app://local/index.html") else {
            webView.loadHTMLString(Self.missingResourcesHTML, baseURL: nil)
            return
        }
        webView.load(URLRequest(url: appURL))
    }

    private static let missingResourcesHTML = """
    <!doctype html>
    <html lang="fr">
      <meta charset="utf-8">
      <style>body{margin:0;background:#090d0f;color:#e7ebec;font:15px -apple-system;display:grid;place-items:center;height:100vh}main{max-width:520px;padding:32px}h1{font-size:22px}p{color:#9aa5aa;line-height:1.55}</style>
      <main><h1>Interface introuvable</h1><p>Le bundle web n’a pas été copié dans les ressources de l’application. Relancez le script de build du projet.</p></main>
    </html>
    """
}

final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}
