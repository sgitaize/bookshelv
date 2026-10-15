import SwiftUI

/// Was die App gerade ist: noch nicht eingerichtet, lokale Bibliothek oder Konto auf einer Instanz.
/// Gespeichert in UserDefaults; die Daten selbst liegen beim App-Host (lokale DB bzw. Instanz).
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    enum Mode: String { case none, local, remote }
    enum Panel: String, Identifiable { case overview, backup, connect, `switch`, support; var id: String { rawValue } }

    /// Standard-Instanz für „Ich habe ein Konto“ (künftig bookshelv.de)
    static let defaultInstance = "https://bookshelv.aize-it.de"

    @Published var mode: Mode { didSet { defaults.set(mode.rawValue, forKey: "mode") } }
    /// gewählte Instanz (auch wenn gerade lokal genutzt wird – dann ist der Wechsel zurück schnell)
    @Published var instance: String? { didSet { defaults.set(instance, forKey: "instance") } }
    @Published var autoBackup: Bool { didSet { defaults.set(autoBackup, forKey: "autoBackup") } }
    @Published var lastBackup: Date? { didSet { defaults.set(lastBackup, forKey: "lastBackup") } }

    /// angemeldete Person laut Weboberfläche (nil = abgemeldet / unbekannt)
    @Published var webUser: (name: String, username: String)?
    /// Seitenwechsel/Neuladen der WebView anstoßen
    @Published var reloadToken = 0
    @Published var pendingPath: String?
    @Published var panel: Panel?

    private let defaults = UserDefaults.standard

    private init() {
        mode = Mode(rawValue: defaults.string(forKey: "mode") ?? "") ?? .none
        instance = defaults.string(forKey: "instance")
        autoBackup = defaults.object(forKey: "autoBackup") as? Bool ?? true
        lastBackup = defaults.object(forKey: "lastBackup") as? Date
        #if DEBUG
        // Testen/Screenshots: xcrun simctl launch … -path /library
        pendingPath = defaults.string(forKey: "path")
        panel = defaults.string(forKey: "panel").flatMap(Panel.init(rawValue:))
        #endif
    }

    var instanceHost: String { instance.flatMap { URL(string: $0)?.host } ?? "" }

    /// Adresse, die die WebView lädt
    func webURL(_ host: NodeHost) -> URL {
        mode == .remote ? host.remoteURL : host.localURL
    }

    /// Modus wechseln und die Oberfläche neu laden (optional gleich auf eine Seite)
    func switchTo(_ m: Mode, path: String? = nil) {
        mode = m
        pendingPath = path
        webUser = nil
        reloadToken += 1
    }
}
