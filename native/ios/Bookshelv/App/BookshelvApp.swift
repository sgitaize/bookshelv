import SwiftUI

@main
struct BookshelvApp: App {
    @StateObject private var host = NodeHost.shared
    @StateObject private var model = AppModel.shared

    init() {
        // lokale Bibliothek gleich mitstarten, dann ist sie da, sobald die Oberfläche lädt
        NodeHost.shared.start(startLocal: AppModel.shared.mode == .local)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(host)
                .environmentObject(model)
        }
    }
}

/// Vollflächige Bibliothek (Weboberfläche); davor beim ersten Start der Willkommensbildschirm,
/// darüber nur native Teile: Scanner, App-Einstellungen.
struct RootView: View {
    @EnvironmentObject private var host: NodeHost
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var phase
    @ObservedObject private var scan = ScanSession.shared
    @State private var pageColor = Color("LaunchBackground")
    @State private var lightPage = false

    var body: some View {
        ZStack {
            pageColor.ignoresSafeArea()
            if let failure = host.failure {
                VStack(spacing: 12) {
                    Text("📚").font(.system(size: 56))
                    Text(failure).multilineTextAlignment(.center).foregroundStyle(.white)
                }.padding(32)
            } else if !host.ready {
                ProgressView().tint(.white)
            } else if model.mode == .none {
                OnboardingView()
            } else {
                LibraryWebView(url: model.webURL(host), reloadToken: model.reloadToken, appInfo: appInfo, localCookie: host.token,
                               initialPath: model.pendingPath, onMessage: handle, onTheme: theme)
                    .ignoresSafeArea()
                    .id(model.mode)          // anderer Modus = andere Origin → frische WebView
            }
        }
        .preferredColorScheme(model.mode == .none ? .dark : (lightPage ? .light : .dark))
        .fullScreenCover(item: $scan.request) { r in ScannerScreen(multi: r.multi) }
        .sheet(item: $model.panel) { p in
            AppPanel(start: p).environmentObject(host).environmentObject(model)
        }
        .onChange(of: phase) { _, p in
            switch p {
            case .active:
                Task {
                    await host.waitReady(timeout: 8)
                    await host.wake()
                    await host.refresh()
                    WebBridge.shared.dispatch(["type": "refresh"])
                }
            case .background:
                BackupManager.shared.backupIfDue()
            default: break
            }
        }
        .onOpenURL { url in openFile(url) }
        .task { await host.setLanguage(L10n.lang) }
    }

    /// `window.bookshelvApp` für die Seite (web/src/lib/app.svelte.ts)
    private var appInfo: [String: Any] {
        [
            "platform": "ios",
            "mode": model.mode == .remote ? "remote" : "local",
            "instance": model.mode == .remote ? (model.instance ?? NSNull()) as Any : NSNull(),
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "scanner": ScanSession.isAvailable
        ]
    }

    private func handle(_ m: WebMessage) {
        switch m {
        case .haptic(let kind): Haptics.play(kind)
        case .panel(let s): model.panel = AppModel.Panel(rawValue: s) ?? .overview
        case .scan(let id, let multi):
            if ScanSession.isAvailable { scan.open(id: id, multi: multi) }
            else { WebBridge.shared.dispatch(["type": "scanClosed", "id": id]) }
        case .scanFeedback(let text, let kind): scan.show(text, kind: kind)
        case .session(let user, let lang):
            model.webUser = user
            model.pendingPath = nil
            if let lang { Task { await host.setLanguage(lang) } }
        }
    }

    private func theme(_ c: UIColor?) {
        guard let c else { return }
        pageColor = Color(c)
        var white: CGFloat = 0
        c.getWhite(&white, alpha: nil)
        lightPage = white > 0.6
    }

    /// „Öffnen in bookshelv“ / Teilen einer CSV-Datei (Export aus Booky, Goodreads, StoryGraph …) → Import-Seite
    private func openFile(_ url: URL) {
        guard url.isFileURL, model.mode != .none else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
        WebBridge.shared.dispatch(["type": "file", "name": url.lastPathComponent, "text": text])
    }
}

enum Haptics {
    static func play(_ kind: String) {
        switch kind {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "select": UISelectionFeedbackGenerator().selectionChanged()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}
