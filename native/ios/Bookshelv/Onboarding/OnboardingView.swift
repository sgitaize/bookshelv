import SwiftUI

/// Erster Start: Standard ist eine Bibliothek nur auf dem Gerät (kein Konto, kein Server).
/// Wer zu einer Instanz gehört, meldet sich an oder löst einen Einladungslink ein. Liegt schon eine
/// iCloud-Sicherung vor (neues iPhone), wird sie angeboten.
struct OnboardingView: View {
    @EnvironmentObject private var host: NodeHost
    @EnvironmentObject private var model: AppModel
    @StateObject private var backup = BackupManager.shared
    @State private var route: [Route] = []
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmRestore = false

    enum Route: Hashable { case local, account, invite }

    var body: some View {
        NavigationStack(path: $route) {
            ScrollView {
                VStack(spacing: 28) {
                    hero
                    VStack(spacing: 12) {
                        Button { route.append(.local) } label: {
                            choice(icon: "iphone", title: T("Ohne Konto loslegen", "Start without an account"),
                                   text: T("Deine Bibliothek liegt nur auf diesem Gerät. Sicherung in deiner iCloud.", "Your library stays on this device. Backed up to your iCloud."),
                                   primary: true)
                        }
                        Button { route.append(.account) } label: {
                            choice(icon: "person.crop.circle", title: T("Ich habe ein Konto", "I have an account"),
                                   text: T("Bei bookshelv.aize-it.de oder einer anderen Instanz – deine Bibliothek ist dann auch unterwegs da.", "On bookshelv.aize-it.de or another instance – your library comes along offline too."))
                        }
                        Button { route.append(.invite) } label: {
                            choice(icon: "envelope.open", title: T("Ich habe eine Einladung", "I have an invitation"),
                                   text: T("Mit dem Link von Freund*innen ein Konto erstellen.", "Create an account with a link from a friend."))
                        }
                    }
                    if let info = backup.remote {
                        restoreCard(info)
                    }
                    Text(T("Freund*innen, Leihanfragen und Leserunden gibt es mit einem Konto. Du kannst die lokale Bibliothek jederzeit mit einem Konto verbinden – ohne doppelte Bücher.",
                           "Friends, loan requests and buddy reads need an account. You can connect your local library to an account any time – without duplicates."))
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                }
                .padding(24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Color("LaunchBackground").ignoresSafeArea())
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .local: localStep
                case .account:
                    AccountFlow { url in finishRemote(url) }
                        .navigationTitle(T("Anmelden", "Sign in"))
                case .invite:
                    AccountFlow(start: .invite) { url in finishRemote(url) }
                        .navigationTitle(T("Einladung", "Invitation"))
                }
            }
        }
        .tint(Color.accentColor)
        .task { await backup.lookup() }
        .confirmationDialog(T("Sicherung wiederherstellen?", "Restore backup?"), isPresented: $confirmRestore, titleVisibility: .visible) {
            Button(T("Wiederherstellen", "Restore")) { Task { await restore() } }
        } message: {
            Text(T("Die Bibliothek aus deiner iCloud wird auf dieses Gerät geholt.", "Your library is brought back from iCloud to this device."))
        }
    }

    private var hero: some View {
        VStack(spacing: 14) {
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array([(38.0, "e8a54b"), (52, "c8553d"), (44, "5b8c85"), (60, "f3ece0"), (36, "5fb0b3"), (48, "e8a54b")].enumerated()), id: \.offset) { _, b in
                    RoundedRectangle(cornerRadius: 3).fill(Color(hex: b.1)).frame(width: 14, height: b.0)
                }
            }
            .padding(.top, 30)
            Text("bookshelv").font(.system(size: 40, weight: .bold, design: .monospaced)).foregroundStyle(.white)
            Text(T("Deine Bücher. Gelesen, geliehen, geliebt.", "Your books. Read, lent, loved."))
                .font(.system(.title3, design: .monospaced)).foregroundStyle(.white.opacity(0.75)).multilineTextAlignment(.center)
        }
    }

    private func choice(icon: String, title: String, text: String, primary: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon).font(.title2).frame(width: 32)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).opacity(0.8).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.bold()).opacity(0.6)
        }
        .padding(16)
        .foregroundStyle(primary ? Color.black : Color.white)
        .background(primary ? Color.accentColor : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(primary ? 0 : 0.12)))
    }

    private func restoreCard(_ info: BackupManager.Info) -> some View {
        Button { confirmRestore = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "icloud.and.arrow.down").font(.title2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(T("Sicherung gefunden", "Backup found")).font(.headline)
                    Text(T("\(info.books) Bücher · \(info.device) · \(info.date.formatted(date: .abbreviated, time: .shortened))",
                           "\(info.books) books · \(info.device) · \(info.date.formatted(date: .abbreviated, time: .shortened))"))
                        .font(.subheadline).opacity(0.8)
                }
                Spacer()
                if busy { ProgressView() } else { Image(systemName: "chevron.right").font(.footnote.bold()).opacity(0.6) }
            }
            .padding(16).foregroundStyle(.white)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        }.disabled(busy)
    }

    private var localStep: some View {
        Form {
            Section {
                TextField(T("Dein Name (optional)", "Your name (optional)"), text: $name).textContentType(.givenName)
            } footer: {
                Text(T("Erscheint nur bei dir – z. B. auf dem Teilen-Bild deiner Lesestatistik.", "Only shown to you – e.g. on the shareable image of your reading stats."))
            }
            Section {
                Button { Task { await startLocal() } } label: {
                    HStack { Text(T("Bibliothek anlegen", "Create library")).bold(); if busy { Spacer(); ProgressView() } }
                }.disabled(busy)
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle(T("Ohne Konto", "Without an account"))
    }

    private func startLocal() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await host.startLocal(name: name.trimmingCharacters(in: .whitespaces).isEmpty ? nil : name)
            model.switchTo(.local, path: "/add")
        } catch { self.error = error.localizedDescription }
    }

    private func restore() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await backup.restoreFromICloud()
            model.switchTo(.local)
        } catch { self.error = error.localizedDescription }
    }

    private func finishRemote(_ url: String) {
        model.instance = url
        model.switchTo(.remote)
    }
}

extension Color {
    init(hex: String) {
        let v = UInt32(hex, radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
