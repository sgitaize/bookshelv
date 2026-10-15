import SwiftUI
import UniformTypeIdentifiers

/// Native App-Einstellungen (aus der Weboberfläche: Einstellungen → App). Alles, was die Seite selbst nicht kann:
/// Sicherung, Konto verbinden (zusammenführen), Instanz wechseln, Trinkgeld.
struct AppPanel: View {
    let start: AppModel.Panel
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var host: NodeHost
    @Environment(\.dismiss) private var dismiss
    @State private var path: [AppModel.Panel] = []

    var body: some View {
        NavigationStack(path: $path) {
            overview
                .navigationDestination(for: AppModel.Panel.self) { destination($0) }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Fertig", "Done")) { dismiss() } } }
        }
        .onAppear { if start != .overview { path = [start] } }
    }

    @ViewBuilder private func destination(_ p: AppModel.Panel) -> some View {
        switch p {
        case .backup: BackupView()
        case .connect: ConnectView()
        case .switch: SwitchView()
        case .support: SupportView()
        case .overview: overview
        }
    }

    private var overview: some View {
        List {
            Section {
                if model.mode == .local {
                    Label(T("Bibliothek nur auf diesem Gerät", "Library on this device only"), systemImage: "iphone")
                    if let s = host.state?.local.summary {
                        Text(T("\(s.books) Bücher · \(s.read) gelesen · \(s.reviews) Bewertungen", "\(s.books) books · \(s.read) read · \(s.reviews) reviews"))
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Label(T("Konto auf \(model.instanceHost)", "Account on \(model.instanceHost)"), systemImage: "person.crop.circle")
                    if let u = model.webUser { Text("\(u.name) · @\(u.username)").foregroundStyle(.secondary) }
                }
            }
            Section {
                if model.mode == .local {
                    NavigationLink(value: AppModel.Panel.backup) { Label(T("Sicherung", "Backup"), systemImage: "icloud") }
                    NavigationLink(value: AppModel.Panel.connect) { Label(T("Mit Konto verbinden", "Connect an account"), systemImage: "person.2") }
                }
                NavigationLink(value: AppModel.Panel.switch) { Label(T("Instanz wechseln oder ohne Konto", "Switch instance or no account"), systemImage: "arrow.left.arrow.right") }
                NavigationLink(value: AppModel.Panel.support) { Label(T("bookshelv unterstützen", "Support bookshelv"), systemImage: "heart") }
            }
            Section {
                Link(destination: URL(string: "https://github.com/sgitaize/bookshelv")!) { Label(T("Quellcode (MIT)", "Source code (MIT)"), systemImage: "chevron.left.forwardslash.chevron.right") }
                Link(destination: URL(string: "https://bookshelv.aize-it.de/privacy")!) { Label(T("Datenschutz", "Privacy"), systemImage: "hand.raised") }
            } footer: {
                Text("bookshelv \(host.state?.version ?? "") · Simon Gutjahr")
            }
        }
        .navigationTitle("bookshelv")
    }
}

// MARK: - Sicherung

struct BackupView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var backup = BackupManager.shared
    @State private var confirmRestore = false
    @State private var importing = false
    @State private var exportFile: URL?
    @State private var message: String?

    var body: some View {
        List {
            Section {
                Toggle(T("Automatisch in iCloud sichern", "Back up to iCloud automatically"), isOn: $model.autoBackup)
                    .disabled(!backup.iCloudAvailable)
                if let last = model.lastBackup {
                    LabeledContent(T("Zuletzt gesichert", "Last backup"), value: last.formatted(date: .abbreviated, time: .shortened))
                }
                Button { Task { await run { try await backup.backupNow(); message = T("Gesichert.", "Backed up.") } } } label: {
                    HStack { Label(T("Jetzt sichern", "Back up now"), systemImage: "icloud.and.arrow.up"); if backup.busy { Spacer(); ProgressView() } }
                }.disabled(backup.busy || !backup.iCloudAvailable)
            } footer: {
                Text(backup.iCloudAvailable
                     ? T("Die Sicherung liegt in deiner iCloud (Dateien → iCloud Drive → bookshelv). Gesichert wird beim Verlassen der App, höchstens alle 15 Minuten.",
                         "The backup lives in your iCloud (Files → iCloud Drive → bookshelv). It runs when you leave the app, at most every 15 minutes.")
                     : T("iCloud ist nicht verfügbar. Melde dich in den Einstellungen bei iCloud an und erlaube iCloud Drive – oder sichere als Datei.",
                         "iCloud is not available. Sign in to iCloud in Settings and enable iCloud Drive – or back up to a file."))
            }
            if let info = backup.remote {
                Section(T("In der iCloud", "In iCloud")) {
                    LabeledContent(T("Stand", "Date"), value: info.date.formatted(date: .abbreviated, time: .shortened))
                    LabeledContent(T("Gerät", "Device"), value: info.device)
                    LabeledContent(T("Bücher", "Books"), value: "\(info.books)")
                    Button(role: .destructive) { confirmRestore = true } label: { Label(T("Wiederherstellen", "Restore"), systemImage: "arrow.counterclockwise") }
                        .disabled(backup.busy)
                }
            }
            Section {
                Button { Task { await run { exportFile = try await backup.exportFile() } } } label: { Label(T("Als Datei sichern …", "Save as file …"), systemImage: "square.and.arrow.up") }
                Button { importing = true } label: { Label(T("Aus Datei wiederherstellen …", "Restore from file …"), systemImage: "doc.badge.arrow.up") }
            } footer: {
                Text(T("Eine Datei-Sicherung enthält die ganze Bibliothek ohne Cover (die lädt die App neu).", "A file backup contains the whole library without covers (the app fetches them again)."))
            }
            if let m = message ?? backup.lastError { Section { Text(m).foregroundStyle(backup.lastError != nil && message == nil ? .red : .secondary) } }
        }
        .navigationTitle(T("Sicherung", "Backup"))
        .task { await backup.lookup() }
        .confirmationDialog(T("Bibliothek ersetzen?", "Replace library?"), isPresented: $confirmRestore, titleVisibility: .visible) {
            Button(T("Durch Sicherung ersetzen", "Replace with backup"), role: .destructive) {
                Task { await run { try await backup.restoreFromICloud(); reloadWeb(); message = T("Wiederhergestellt.", "Restored.") } }
            }
        } message: {
            Text(T("Alles, was seit der Sicherung dazukam, geht verloren.", "Everything added since the backup will be lost."))
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .database].compactMap { $0 }) { result in
            guard case .success(let url) = result else { return }
            Task { await run { try await backup.restore(fromFile: url); reloadWeb(); message = T("Wiederhergestellt.", "Restored.") } }
        }
        .sheet(item: $exportFile) { ShareSheet(items: [$0]) }
    }

    private func run(_ f: () async throws -> Void) async {
        message = nil
        do { try await f() } catch { message = error.localizedDescription }
    }
    private func reloadWeb() { model.reloadToken += 1 }
}

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Instanz wechseln

struct SwitchView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var host: NodeHost
    @Environment(\.dismiss) private var dismiss
    @State private var signIn = false
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmLogout = false

    var body: some View {
        List {
            Section {
                Button { Task { await useLocal() } } label: {
                    row(icon: "iphone", title: T("Ohne Konto (nur dieses Gerät)", "Without an account (this device only)"),
                        sub: host.state?.local.exists == true ? T("Deine lokale Bibliothek", "Your local library") : T("Neue, leere Bibliothek", "New, empty library"),
                        active: model.mode == .local)
                }.disabled(busy || model.mode == .local)
                if let instance = model.instance, host.state?.remote.loggedIn == true {
                    Button { model.switchTo(.remote); dismiss() } label: {
                        row(icon: "person.crop.circle", title: T("Konto auf \(model.instanceHost)", "Account on \(model.instanceHost)"), sub: instance, active: model.mode == .remote)
                    }.disabled(model.mode == .remote)
                }
                Button { signIn = true } label: {
                    row(icon: "plus.circle", title: T("Bei einer Instanz anmelden …", "Sign in to an instance …"), sub: T("Oder neues Konto bzw. Einladung", "Or new account / invitation"), active: false)
                }
            } footer: {
                if model.mode == .local && host.state?.local.summary?.books ?? 0 > 0 {
                    Text(T("Tipp: Willst du deine lokale Bibliothek mitnehmen, nutze „Mit Konto verbinden“ – das führt beide ohne Dubletten zusammen.",
                           "Tip: to take your local library along, use “Connect an account” – it merges both without duplicates."))
                }
            }
            if host.state?.remote.loggedIn == true {
                Section {
                    Button(role: .destructive) { confirmLogout = true } label: { Label(T("Von \(model.instanceHost) abmelden", "Sign out of \(model.instanceHost)"), systemImage: "rectangle.portrait.and.arrow.right") }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle(T("Wechseln", "Switch"))
        .sheet(isPresented: $signIn) {
            NavigationStack {
                AccountFlow { url in
                    model.instance = url
                    signIn = false
                    model.switchTo(.remote)
                    dismiss()
                }
                .navigationTitle(T("Anmelden", "Sign in"))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Abbrechen", "Cancel")) { signIn = false } } }
            }
            .environmentObject(host)
        }
        .confirmationDialog(T("Abmelden?", "Sign out?"), isPresented: $confirmLogout, titleVisibility: .visible) {
            Button(T("Abmelden", "Sign out"), role: .destructive) {
                Task {
                    await host.logout()
                    // ohne Konto weiter: lokale Bibliothek, sonst Startbildschirm
                    if host.state?.local.exists == true { model.switchTo(.local) } else { model.switchTo(.none) }
                    dismiss()
                }
            }
        } message: {
            Text(T("Offline vorgemerkte Änderungen, die noch nicht übertragen wurden, gehen verloren.", "Offline changes that have not been sent yet will be lost."))
        }
    }

    private func row(icon: String, title: String, sub: String, active: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).frame(width: 28)
            VStack(alignment: .leading) {
                Text(title).foregroundStyle(.primary)
                Text(sub).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            if active { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
        }
    }

    private func useLocal() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await host.startLocal(name: nil)
            model.switchTo(.local)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
