import Foundation

/// Eingebettetes Node (nodejs-mobile) mit dem App-Host `server/host.js` (Quelle: server/src/mobile/host.ts).
///
/// Drei Ports auf 127.0.0.1: Steuerung (nur diese Klasse, mit Token), Lokal (Bibliothek auf dem Gerät)
/// und Instanz (Oberfläche aus dem Bundle, API zur gewählten Instanz). Feste Wunsch-Ports, damit die
/// Origins – und damit localStorage/Offline-Cache der WebView – über App-Starts hinweg gleich bleiben.
@MainActor
final class NodeHost: ObservableObject {
    static let shared = NodeHost()

    struct Summary: Codable, Equatable {
        var books: Int
        var read: Int
        var reviews: Int
        var wishlist: Int
        var lists: Int
        var loans: Int
        var name: String?
    }
    struct LocalState: Codable, Equatable { var running: Bool; var exists: Bool; var summary: Summary? }
    struct RemoteState: Codable, Equatable { var url: String?; var loggedIn: Bool }
    struct State: Codable, Equatable { var version: String; var local: LocalState; var remote: RemoteState }

    @Published private(set) var ready = false
    @Published private(set) var state: State?
    @Published private(set) var failure: String?

    let controlPort: Int
    let localPort: Int
    let remotePort: Int
    /// Steuer-Token und zugleich Anmeldung im Lokal-Modus (Cookie bs_app); je Start neu
    let token = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var started = false

    var localURL: URL { URL(string: "http://127.0.0.1:\(localPort)/")! }
    var remoteURL: URL { URL(string: "http://127.0.0.1:\(remotePort)/")! }

    /// Lokale Bibliothek (Datenbank, Cover) – Teil des Geräte-Backups
    nonisolated static let dataDir: URL = appSupport.appendingPathComponent("library", isDirectory: true)
    /// Host-Zustand (Sitzung der Instanz, Cover-Cache, Archiv)
    nonisolated static let varDir: URL = appSupport.appendingPathComponent("host", isDirectory: true)
    nonisolated private static var appSupport: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("bookshelv", isDirectory: true)
    }

    private init() {
        let ports = NodeHost.freePorts(preferred: 8470, count: 3)
        controlPort = ports[0]; localPort = ports[1]; remotePort = ports[2]
    }

    // MARK: Start

    func start(startLocal: Bool) {
        guard !started else { return }
        started = true
        guard let server = Bundle.main.url(forResource: "server", withExtension: nil) else {
            failure = T("App-Dateien fehlen im Bundle.", "App files are missing from the bundle.")
            return
        }
        let fm = FileManager.default
        try? fm.createDirectory(at: NodeHost.dataDir, withIntermediateDirectories: true)
        try? fm.createDirectory(at: NodeHost.varDir.appendingPathComponent("cache"), withIntermediateDirectories: true)
        // Cover-Cache der Instanz muss nicht ins Geräte-Backup (lässt sich neu laden)
        var cache = NodeHost.varDir.appendingPathComponent("cache")
        var noBackup = URLResourceValues(); noBackup.isExcludedFromBackup = true
        try? cache.setResourceValues(noBackup)

        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        setenv("BS_TOKEN", token, 1)
        setenv("BS_CONTROL_PORT", String(controlPort), 1)
        setenv("BS_LOCAL_PORT", String(localPort), 1)
        setenv("BS_REMOTE_PORT", String(remotePort), 1)
        setenv("BS_DATA", NodeHost.dataDir.path, 1)
        setenv("BS_VAR", NodeHost.varDir.path, 1)
        setenv("BS_PUBLIC", server.appendingPathComponent("public").path, 1)
        setenv("BS_VERSION", version, 1)
        setenv("BS_START_LOCAL", startLocal ? "1" : "0", 1)
        setenv("NODE_NO_WARNINGS", "1", 1)

        let script = server.appendingPathComponent("host.js").path
        let thread = Thread {
            let rc = bs_node_start(script)
            Task { @MainActor in NodeHost.shared.failure = T("Der App-Dienst wurde beendet (\(rc)).", "The app service stopped (\(rc)).") }
        }
        thread.name = "node"
        thread.stackSize = 8 * 1024 * 1024
        thread.start()
        Task { await waitReady() }
    }

    /// Wartet, bis der Host antwortet (beim Start und nach dem Aufwachen: er öffnet weggenommene Ports binnen ~2 s neu)
    @discardableResult
    func waitReady(timeout: TimeInterval = 25) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if let s: State = try? await call("GET", "state", timeout: 2) {
                state = s
                ready = true
                return true
            }
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        if !ready { failure = T("Der App-Dienst startet nicht.", "The app service does not start.") }
        return false
    }

    /// Zurück im Vordergrund: iOS hat die horchenden Sockets evtl. weggenommen → der Host öffnet sie sofort neu
    /// (statt erst bei seiner 2-s-Prüfung), damit die ersten Anfragen der WebView nicht ins Leere gehen
    func wake() async {
        struct R: Decodable { var ok: Bool }
        _ = try? await call("POST", "wake", timeout: 3) as R
    }

    func refresh() async {
        if let s: State = try? await call("GET", "state") { state = s }
    }

    // MARK: Lokal

    @discardableResult
    func startLocal(name: String?) async throws -> Summary? {
        struct R: Decodable { var summary: Summary? }
        let r: R = try await call("POST", "local/start", ["name": name ?? NSNull()], timeout: 30)
        await refresh()
        return r.summary
    }

    struct Snapshot: Decodable { var file: String; var size: Int; var summary: Summary? }
    func snapshot(to dir: URL) async throws -> Snapshot {
        try await call("POST", "local/snapshot", ["dir": dir.path], timeout: 60)
    }

    func checkBackup(dir: URL) async throws {
        struct R: Decodable { var ok: Bool }
        let _: R = try await call("POST", "local/check", ["dir": dir.path], timeout: 60)
    }

    @discardableResult
    func restore(from dir: URL) async throws -> Summary? {
        struct R: Decodable { var summary: Summary? }
        let r: R = try await call("POST", "local/restore", ["dir": dir.path], timeout: 120)
        await refresh()
        return r.summary
    }

    func archiveLocal() async throws -> String {
        struct R: Decodable { var archive: String }
        let r: R = try await call("POST", "local/archive", [:], timeout: 120)
        await refresh()
        return r.archive
    }

    // MARK: Instanz

    struct InstanceStatus: Decodable { var openRegistration: Bool?; var version: String?; var needsSetup: Bool?; var imprintUrl: String? }
    struct Probe: Decodable { var url: String; var status: InstanceStatus }
    func probe(_ url: String) async throws -> Probe {
        try await call("POST", "remote/probe", ["url": url], timeout: 20)
    }

    func useInstance(_ url: String) async throws {
        struct R: Decodable { var url: String }
        let _: R = try await call("POST", "remote/use", ["url": url])
        await refresh()
    }

    struct Me: Decodable { var username: String; var displayName: String }
    func remoteMe() async -> Me? {
        struct R: Decodable { var me: Me? }
        return (try? await call("GET", "remote/me", timeout: 15) as R)?.me
    }

    func logout() async {
        struct R: Decodable { var ok: Bool }
        let _: R? = try? await call("POST", "remote/logout", [:], timeout: 15)
        await refresh()
    }

    /// Anmelden bzw. registrieren über den Instanz-Port: der Host merkt sich die Sitzung
    func signIn(username: String, password: String, register: Bool = false, displayName: String? = nil, invite: String? = nil) async throws {
        var req = URLRequest(url: remoteURL.appendingPathComponent(register ? "api/register" : "api/login"))
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(remoteURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        req.setValue(L10n.lang, forHTTPHeaderField: "x-lang")
        var body: [String: Any] = ["username": username, "password": password]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        if let invite, !invite.isEmpty { body["token"] = invite }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw HostError(msg ?? T("Anmeldung fehlgeschlagen", "Sign-in failed"))
        }
        await refresh()
    }

    struct MergeStart: Decodable { var id: Int?; var total: Int?; var empty: Bool? }
    func mergeStart(conflict: String, visibility: String, label: String) async throws -> MergeStart {
        try await call("POST", "merge/start", ["conflict": conflict, "visibility": visibility, "label": label], timeout: 120)
    }

    struct MergeStatus: Decodable {
        var status: String; var total: Int; var done: Int; var ok: Int; var exists: Int
        var failed: [String]; var conflictCount: Int
    }
    func mergeStatus(_ id: Int) async throws -> MergeStatus {
        try await call("POST", "merge/status", ["id": id], timeout: 30)
    }

    func setLanguage(_ lang: String) async {
        struct R: Decodable { var ok: Bool }
        let _: R? = try? await call("POST", "lang", ["lang": lang])
    }

    // MARK: Steuer-API

    struct HostError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }

    private func call<Out: Decodable>(_ method: String, _ path: String, _ body: [String: Any]? = nil, timeout: TimeInterval = 10) async throws -> Out {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(controlPort)/\(path)")!)
        req.httpMethod = method
        req.timeoutInterval = timeout
        req.setValue(token, forHTTPHeaderField: "x-bs-token")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? T("Fehler", "Error")
            throw HostError(msg)
        }
        return try JSONDecoder().decode(Out.self, from: data)
    }

    // MARK: Ports

    /// Bevorzugt `count` aufeinanderfolgende Ports ab `preferred`, sonst freie vom System.
    private static func freePorts(preferred: Int, count: Int) -> [Int] {
        func bindable(_ p: Int) -> Int? {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            guard fd >= 0 else { return nil }
            defer { close(fd) }
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = in_port_t(UInt16(p).bigEndian)
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")
            let ok = withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            guard ok == 0 else { return nil }
            var out = sockaddr_in(); var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            _ = withUnsafeMutablePointer(to: &out) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
            }
            return Int(UInt16(bigEndian: out.sin_port))
        }
        let wanted = (0..<count).map { preferred + $0 }
        if wanted.allSatisfy({ bindable($0) != nil }) { return wanted }
        return (0..<count).map { i in bindable(wanted[i]) ?? bindable(0) ?? wanted[i] }
    }
}
