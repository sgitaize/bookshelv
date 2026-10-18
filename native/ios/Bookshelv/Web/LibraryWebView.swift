import SafariServices
import SwiftUI
import WebKit

/// Nachrichten der Weboberfläche an die App (`window.webkit.messageHandlers.bookshelv.postMessage({a: …})`,
/// Gegenstück: web/src/lib/app.svelte.ts).
enum WebMessage {
    case haptic(String)
    case panel(String)
    case scan(id: Int, multi: Bool)
    case scanFeedback(text: String, kind: String)
    case session(user: (name: String, username: String)?, lang: String?)

    init?(_ body: Any) {
        guard let d = body as? [String: Any], let a = d["a"] as? String else { return nil }
        switch a {
        case "haptic": self = .haptic(d["k"] as? String ?? "light")
        case "panel": self = .panel(d["s"] as? String ?? "overview")
        case "scan": self = .scan(id: d["id"] as? Int ?? 0, multi: d["multi"] as? Bool ?? false)
        case "scanFeedback": self = .scanFeedback(text: d["text"] as? String ?? "", kind: d["kind"] as? String ?? "ok")
        case "session":
            let u = d["user"] as? [String: Any]
            let user = u.map { (name: $0["name"] as? String ?? "", username: $0["username"] as? String ?? "") }
            self = .session(user: user, lang: d["lang"] as? String)
        default: return nil
        }
    }
}

/// Steuert die WebView von außen (Ereignisse an die Seite schicken)
@MainActor
final class WebBridge: ObservableObject {
    static let shared = WebBridge()
    weak var web: WKWebView?

    /// Ereignis an `window.bookshelvNative.dispatch` (web/src/lib/app.svelte.ts)
    func dispatch(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.bookshelvNative && window.bookshelvNative.dispatch(\(json))", completionHandler: nil)
    }
}

/// Die Bibliothek: WKWebView auf dem eingebetteten App-Host (lokal oder Instanz-Port).
struct LibraryWebView: UIViewRepresentable {
    let url: URL
    let reloadToken: Int
    let appInfo: [String: Any]
    let localCookie: String
    var initialPath: String?
    var onMessage: (WebMessage) -> Void
    var onTheme: (UIColor?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()        // localStorage, Lesecache, vorgemerkte Änderungen bleiben erhalten
        cfg.allowsInlineMediaPlayback = true
        cfg.userContentController.add(context.coordinator, name: "bookshelv")
        cfg.userContentController.addUserScript(Self.infoScript(appInfo))
        cfg.applicationNameForUserAgent = "BookshelvApp/1"
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never   // die Seite nutzt env(safe-area-inset-*)
        web.isOpaque = false
        web.backgroundColor = UIColor(named: "LaunchBackground")
        web.scrollView.backgroundColor = UIColor(named: "LaunchBackground")
        #if DEBUG
        web.isInspectable = true
        #endif
        context.coordinator.web = web
        context.coordinator.lastToken = reloadToken
        context.coordinator.observeTheme()
        WebBridge.shared.web = web
        context.coordinator.load(path: initialPath)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        let c = context.coordinator
        let changedOrigin = c.parent.url != url
        c.parent = self
        if changedOrigin || c.lastToken != reloadToken {
            c.lastToken = reloadToken
            // App-Infos (Modus, Instanz) neu setzen, bevor die Seite neu lädt
            web.configuration.userContentController.removeAllUserScripts()
            web.configuration.userContentController.addUserScript(Self.infoScript(appInfo))
            c.load(path: initialPath)
        }
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "bookshelv")
    }

    /// `window.bookshelvApp` steht schon bereit, bevor das erste Skript der Seite läuft
    static func infoScript(_ info: [String: Any]) -> WKUserScript {
        let json = (try? JSONSerialization.data(withJSONObject: info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return WKUserScript(source: "window.bookshelvApp = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
        var parent: LibraryWebView
        weak var web: WKWebView?
        var lastToken = 0
        private var retries = 0
        private var themeObservation: NSKeyValueObservation?
        private var downloads: [WKDownload: URL] = [:]

        init(_ parent: LibraryWebView) { self.parent = parent }

        func load(path: String?) {
            guard let web else { return }
            var target = parent.url
            if let path, let u = URL(string: path, relativeTo: parent.url) { target = u.absoluteURL }
            // Lokal-Modus: Anmeldung per Cookie bs_app (gilt für 127.0.0.1, die Instanz-Weiterleitung ignoriert es)
            let cookie = HTTPCookie(properties: [
                .domain: "127.0.0.1", .path: "/", .name: "bs_app", .value: parent.localCookie,
                .expires: Date().addingTimeInterval(365 * 86400)
            ])
            if let cookie {
                web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { web.load(URLRequest(url: target)) }
            } else {
                web.load(URLRequest(url: target))
            }
        }

        func observeTheme() {
            themeObservation = web?.observe(\.themeColor, options: [.initial, .new]) { [weak self] web, _ in
                let color = web.themeColor
                Task { @MainActor in self?.parent.onTheme(color) }
            }
        }

        // MARK: Nachrichten

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, isOwn(message.frameInfo.request.url), let m = WebMessage(message.body) else { return }
            parent.onMessage(m)
        }

        // MARK: Navigation: nur die eigene Seite in der App, alles andere in Safari

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if action.shouldPerformDownload { return decisionHandler(.download) }
            if isOwn(url) || ["about", "blob", "data"].contains(url.scheme ?? "") { return decisionHandler(.allow) }
            decisionHandler(.cancel)
            openExternally(url)
        }

        // Dateien (CSV-Export, JSON) und Bilder (Jahresrückblick) → Teilen-Dialog
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
            let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
            if disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType { return decisionHandler(.download) }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(suggestedFilename.isEmpty ? "bookshelv" : suggestedFilename)
            downloads[download] = file
            completionHandler(file)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let file = downloads.removeValue(forKey: download) else { return }
            share(file)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloads.removeValue(forKey: download)
        }

        // target="_blank"
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if isOwn(url) { webView.load(URLRequest(url: url)) } else { openExternally(url) }
            }
            return nil
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
            present(alert: message, confirm: false) { _ in completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
            present(alert: message, confirm: true, completion: completionHandler)
        }

        // Kamera für den Web-Scanner (falls der native Scanner fehlt): nur für die eigene Seite
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == "127.0.0.1" && type == .camera ? .grant : .deny)
        }

        // Host öffnet seinen Port nach dem Aufwachen gerade neu → kurz warten, erneut laden
        func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
            guard retries < 30 else { return }
            retries += 1
            Task { @MainActor in
                await NodeHost.shared.waitReady(timeout: 5)
                self.load(path: nil)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            retries = 0
            #if DEBUG
            // Testen/Screenshots: xcrun simctl launch … -js 'window.scrollTo(0, 1e6)' (nach jedem Laden, kurz verzögert)
            if let js = UserDefaults.standard.string(forKey: "js"), !js.isEmpty {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { webView.evaluateJavaScript(js) }
            }
            #endif
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

        // MARK: Hilfen

        private func isOwn(_ url: URL?) -> Bool {
            guard let url else { return false }
            return url.host == "127.0.0.1" && url.port == parent.url.port
        }

        private func openExternally(_ url: URL) {
            guard url.scheme == "https" || url.scheme == "http" else { UIApplication.shared.open(url); return }
            topController()?.present(SFSafariViewController(url: url), animated: true)
        }

        private func share(_ file: URL) {
            guard let top = topController() else { return }
            let vc = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            vc.popoverPresentationController?.sourceView = top.view
            vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
            top.present(vc, animated: true)
        }

        private func present(alert message: String, confirm: Bool, completion: @escaping (Bool) -> Void) {
            let ac = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            if confirm { ac.addAction(UIAlertAction(title: T("Abbrechen", "Cancel"), style: .cancel) { _ in completion(false) }) }
            ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in completion(true) })
            guard let top = topController() else { return completion(false) }
            top.present(ac, animated: true)
        }

        private func topController() -> UIViewController? {
            var vc = web?.window?.rootViewController
            while let p = vc?.presentedViewController { vc = p }
            return vc
        }
    }
}
