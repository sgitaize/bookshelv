import SwiftUI

/// Lokale Bibliothek mit einem Konto zusammenführen (Stufe 3):
/// 1. anmelden/registrieren, 2. Regeln wählen, 3. als Import-Job zur Instanz hochladen (Abgleich, keine Dubletten,
/// rückgängig machbar), 4. lokale Bibliothek archivieren und auf das Konto umschalten – danach gibt es nur noch eine Datenbank.
struct ConnectView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var host: NodeHost
    @Environment(\.dismiss) private var dismiss

    enum Step { case account, options, running, done }
    @State private var step: Step = .account
    @State private var instance = ""
    @State private var conflict = "ask"
    @State private var visibility = "instance"
    @State private var jobId: Int?
    @State private var status: NodeHost.MergeStatus?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Group {
            switch step {
            case .account:
                AccountFlow(intro: T("Melde dich bei der Instanz an, mit der du deine Bibliothek verbinden willst – oder lege dort ein Konto an.",
                                     "Sign in to the instance you want to connect your library to – or create an account there.")) { url in
                    instance = url
                    step = .options
                }
            case .options: options
            case .running, .done: progress
            }
        }
        .navigationTitle(T("Mit Konto verbinden", "Connect an account"))
        .navigationBarBackButtonHidden(step == .running)
        .interactiveDismissDisabled(step == .running)
    }

    private var summary: NodeHost.Summary? { host.state?.local.summary }

    private var options: some View {
        Form {
            Section {
                if let s = summary {
                    LabeledContent(T("Bücher im Regal", "Books on shelf"), value: "\(s.books)")
                    LabeledContent(T("Gelesen", "Read"), value: "\(s.read)")
                    LabeledContent(T("Bewertungen", "Reviews"), value: "\(s.reviews)")
                    LabeledContent(T("Wunschliste", "Wishlist"), value: "\(s.wishlist)")
                    LabeledContent(T("Leselisten", "Reading lists"), value: "\(s.lists)")
                    LabeledContent(T("Verliehen", "Lent out"), value: "\(s.loans)")
                }
            } header: { Text(T("Wird übernommen", "Will be transferred")) } footer: {
                Text(T("Dazu Lesedaten, Fortschritt, Stimmungen, Top 5, Reihen, eigene Cover und gefolgte Autor*innen. Bücher, die schon in deinem Konto stehen, werden zusammengelegt – nicht verdoppelt.",
                       "Plus reading dates, progress, moods, top 5, series, custom covers and followed authors. Books already in your account are merged – not duplicated."))
            }
            Section {
                Picker(T("Bei Unterschieden", "When they differ"), selection: $conflict) {
                    Text(T("Nachfragen", "Ask me")).tag("ask")
                    Text(T("Konto behalten", "Keep account")).tag("mine")
                    Text(T("Vom Gerät übernehmen", "Take from device")).tag("theirs")
                }
                Picker(T("Bewertungen sichtbar für", "Reviews visible to"), selection: $visibility) {
                    Text(T("Freund*innen", "Friends")).tag("instance")
                    Text(T("Nur mich", "Only me")).tag("private")
                }
            } footer: {
                Text(T("Unterschiede gibt es, wenn ein Buch im Konto z. B. einen anderen Lesestand hat. „Nachfragen“ zeigt dir jeden Fall danach unter Importe.",
                       "They differ when, say, a book has a different reading status in your account. “Ask me” lists every case afterwards under Imports."))
            }
            Section {
                Button { Task { await startMerge() } } label: {
                    HStack { Text(T("Jetzt zusammenführen", "Merge now")).bold(); if busy { Spacer(); ProgressView() } }
                }.disabled(busy)
            } footer: {
                Text(T("Die lokale Bibliothek wird danach archiviert (eine Kopie bleibt in der Sicherung) und die App nutzt dein Konto. Der Import lässt sich im Konto unter Importe rückgängig machen.",
                       "Afterwards the local library is archived (a copy stays in the backup) and the app uses your account. The import can be undone in your account under Imports."))
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
    }

    private var progress: some View {
        VStack(spacing: 22) {
            Spacer()
            if step == .done {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(.green)
                Text(T("Zusammengeführt", "Merged")).font(.title2.bold())
            } else {
                ProgressView(value: Double(status?.done ?? 0), total: Double(max(status?.total ?? 1, 1)))
                    .frame(maxWidth: 320)
                Text(T("Übertrage deine Bibliothek …", "Transferring your library …")).font(.headline)
                Text(T("Bitte die App geöffnet lassen.", "Please keep the app open.")).font(.footnote).foregroundStyle(.secondary)
            }
            if let s = status {
                VStack(spacing: 6) {
                    Text(T("\(s.done) von \(s.total) Büchern", "\(s.done) of \(s.total) books"))
                    Text(T("\(s.ok) übernommen · \(s.exists) schon vorhanden", "\(s.ok) transferred · \(s.exists) already there")).foregroundStyle(.secondary)
                    if s.conflictCount > 0 { Text(T("\(s.conflictCount) Unterschiede zum Nachsehen", "\(s.conflictCount) differences to review")).foregroundStyle(.orange) }
                    if !s.failed.isEmpty { Text(T("\(s.failed.count) nicht gefunden", "\(s.failed.count) not found")).foregroundStyle(.red) }
                }.font(.subheadline)
            }
            if let error { Text(error).foregroundStyle(.red).multilineTextAlignment(.center) }
            Spacer()
            if step == .done {
                Button {
                    model.instance = instance
                    model.switchTo(.remote, path: (status?.conflictCount ?? 0) > 0 || !(status?.failed.isEmpty ?? true) ? "/imports" : "/library")
                    dismiss()
                } label: { Text(T("Zu meinem Konto", "Go to my account")).bold().frame(maxWidth: 320) }
                .buttonStyle(.borderedProminent).controlSize(.large)
            }
        }
        .padding(24)
    }

    private func startMerge() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            // vorher noch einmal sichern – falls etwas schiefgeht, ist der Stand in der iCloud
            if model.autoBackup { try? await BackupManager.shared.backupNow() }
            let label = T("Bibliothek vom \(UIDevice.current.model)", "Library from \(UIDevice.current.model)")
            let r = try await host.mergeStart(conflict: conflict, visibility: visibility, label: label)
            guard let id = r.id else {
                // nichts zu übertragen (leere lokale Bibliothek)
                _ = try await host.archiveLocal()
                step = .done
                return
            }
            jobId = id
            step = .running
            while true {
                let s = try await host.mergeStatus(id)
                status = s
                if s.status != "running" { break }
                try await Task.sleep(nanoseconds: 800_000_000)
            }
            guard status?.status == "done" else { throw NodeHost.HostError(T("Der Import wurde abgebrochen.", "The import was cancelled.")) }
            _ = try await host.archiveLocal()
            step = .done
        } catch {
            self.error = error.localizedDescription
            if step == .running && jobId == nil { step = .options }
        }
    }
}
