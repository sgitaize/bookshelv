import SwiftUI

/// Instanz wählen und anmelden/registrieren – nativ, damit Passwort-AutoFill und Tastatur wie gewohnt funktionieren.
/// Die Sitzung landet im App-Host (er hält das Cookie der Instanz); `onDone` bekommt die Instanz-Adresse.
struct AccountFlow: View {
    enum Start { case signIn, invite }
    var start: Start = .signIn
    var intro: String? = nil
    var onDone: (String) -> Void

    @EnvironmentObject private var host: NodeHost
    @State private var address = AppModel.shared.instance ?? AppModel.defaultInstance
    @State private var inviteLink = ""
    @State private var probe: NodeHost.Probe?
    @State private var register = false
    @State private var username = ""
    @State private var displayName = ""
    @State private var password = ""
    @State private var password2 = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    enum Field { case address, invite, user, name, pw, pw2 }

    /// „https://host/invite/TOKEN“ → (https://host, TOKEN)
    private var invite: (url: String, token: String)? {
        guard let u = URL(string: inviteLink.trimmingCharacters(in: .whitespacesAndNewlines)), let host = u.host,
              u.pathComponents.count >= 3, u.pathComponents[1] == "invite" else { return nil }
        return ("\(u.scheme ?? "https")://\(host)\(u.port.map { ":\($0)" } ?? "")", u.pathComponents[2])
    }

    var body: some View {
        Form {
            if let intro { Section { Text(intro).foregroundStyle(.secondary) } }
            if probe == nil {
                if start == .invite {
                    Section {
                        TextField(T("Einladungslink einfügen", "Paste invitation link"), text: $inviteLink, axis: .vertical)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focus, equals: .invite)
                        if inviteLink.isEmpty {
                            PasteButton(payloadType: String.self) { strings in inviteLink = strings.first ?? "" }
                        }
                    } header: { Text(T("Einladung", "Invitation")) } footer: {
                        Text(T("Den Link hast du von jemandem bekommen, der schon bookshelv nutzt.", "You got the link from someone who already uses bookshelv."))
                    }
                } else {
                    Section {
                        TextField("bookshelv.aize-it.de", text: $address)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .textContentType(.URL).focused($focus, equals: .address)
                            .onSubmit { Task { await check() } }
                    } header: { Text(T("Adresse der Instanz", "Instance address")) } footer: {
                        Text(T("Eine Instanz ist ein bookshelv-Server, z. B. für deinen Freundeskreis.", "An instance is a bookshelv server, e.g. for your circle of friends."))
                    }
                }
                Section {
                    Button { Task { await check() } } label: { HStack { Text(T("Weiter", "Continue")); if busy { Spacer(); ProgressView() } } }
                        .disabled(busy || (start == .invite ? invite == nil : address.trimmingCharacters(in: .whitespaces).isEmpty))
                }
            } else if let probe {
                Section {
                    LabeledContent(T("Instanz", "Instance"), value: URL(string: probe.url)?.host ?? probe.url)
                    if start == .signIn && probe.status.openRegistration == true {
                        Picker("", selection: $register) {
                            Text(T("Anmelden", "Sign in")).tag(false)
                            Text(T("Neues Konto", "New account")).tag(true)
                        }.pickerStyle(.segmented)
                    }
                }
                Section {
                    TextField(T("Anmeldename", "Username"), text: $username)
                        .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focus, equals: .user)
                    if register {
                        TextField(T("Anzeigename (optional)", "Display name (optional)"), text: $displayName)
                            .textContentType(.nickname).focused($focus, equals: .name)
                    }
                    SecureField(T("Passwort", "Password"), text: $password)
                        .textContentType(register ? .newPassword : .password).focused($focus, equals: .pw)
                        .onSubmit { if !register { Task { await submit() } } }
                    if register {
                        SecureField(T("Passwort wiederholen", "Repeat password"), text: $password2)
                            .textContentType(.newPassword).focused($focus, equals: .pw2)
                    }
                } footer: {
                    if register { Text(T("3–32 Zeichen: Buchstaben, Ziffern, . _ -  · Passwort mindestens 8 Zeichen. Keine E-Mail-Adresse nötig.", "3–32 characters: letters, digits, . _ -  · Password at least 8 characters. No email needed.")) }
                }
                Section {
                    Button { Task { await submit() } } label: {
                        HStack { Text(register ? T("Konto erstellen", "Create account") : T("Anmelden", "Sign in")).bold(); if busy { Spacer(); ProgressView() } }
                    }.disabled(busy || username.count < 3 || password.isEmpty)
                    Button(T("Andere Instanz", "Other instance")) { self.probe = nil; error = nil }.disabled(busy)
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .onAppear { focus = start == .invite ? .invite : .address }
    }

    private func check() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let url = start == .invite ? (invite?.url ?? "") : address
            let p = try await host.probe(url)
            if p.status.needsSetup == true { throw NodeHost.HostError(T("Diese Instanz ist noch nicht eingerichtet.", "This instance is not set up yet.")) }
            try await host.useInstance(p.url)
            // schon angemeldet (z. B. nach einem Wechsel hin und zurück)?
            if start == .signIn, await host.remoteMe() != nil { return onDone(p.url) }
            probe = p
            register = start == .invite
            focus = .user
        } catch { self.error = error.localizedDescription }
    }

    private func submit() async {
        guard let probe else { return }
        if register && password != password2 { error = T("Die Passwörter stimmen nicht überein.", "Passwords do not match."); return }
        busy = true; error = nil
        defer { busy = false }
        do {
            try await host.signIn(username: username.trimmingCharacters(in: .whitespaces), password: password, register: register,
                                  displayName: displayName, invite: start == .invite ? invite?.token : nil)
            onDone(probe.url)
        } catch { self.error = error.localizedDescription }
    }
}
