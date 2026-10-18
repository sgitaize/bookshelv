import StoreKit
import SwiftUI

/// Trinkgeld per In-App-Kauf (Verbrauchsartikel). Die Produkte legt der Account-Inhaber in App Store Connect an;
/// zum Testen in Xcode liefert Bookshelv.storekit dieselben IDs.
@MainActor
final class TipJar: ObservableObject {
    static let shared = TipJar()
    static let productIDs = ["de.sgitaize.bookshelv.tip.small", "de.sgitaize.bookshelv.tip.medium", "de.sgitaize.bookshelv.tip.large"]

    @Published private(set) var products: [Product] = []
    @Published private(set) var loading = false
    @Published private(set) var thanks = false
    @Published var error: String?
    private var updates: Task<Void, Never>?

    private init() {
        // Käufe, die außerhalb abgeschlossen wurden (z. B. nach „Kaufen erfragen“), sauber abschließen
        updates = Task {
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
            }
        }
    }

    func load() async {
        guard products.isEmpty, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            products = try await Product.products(for: Self.productIDs).sorted { $0.price < $1.price }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func buy(_ p: Product) async {
        error = nil
        do {
            switch try await p.purchase() {
            case .success(let result):
                if case .verified(let t) = result { await t.finish(); thanks = true }
            case .pending, .userCancelled: break
            @unknown default: break
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SupportView: View {
    @StateObject private var jar = TipJar.shared

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text(T("bookshelv ist kostenlos – ohne Werbung, ohne Tracking, ohne Abo.", "bookshelv is free – no ads, no tracking, no subscription."))
                        .font(.headline)
                    Text(T("Ich baue die App in meiner Freizeit. Wenn sie dir gefällt, freue ich mich über ein Trinkgeld – es schaltet nichts frei, es hilft einfach.",
                           "I build the app in my spare time. If you like it, a tip is much appreciated – it unlocks nothing, it simply helps."))
                        .foregroundStyle(.secondary)
                }.padding(.vertical, 4)
            }
            Section {
                if jar.loading {
                    ProgressView()
                } else if jar.products.isEmpty {
                    #if DEBUG
                    // Review-Screenshot der In-App-Käufe im Simulator (dort liefert der Store nichts): -tipPreview YES
                    if UserDefaults.standard.bool(forKey: "tipPreview") {
                        ForEach(Self.preview, id: \.0) { p in row(emoji: emoji(p.0), name: p.1, description: T("Danke! Schaltet nichts frei, hilft einfach.", "Thank you! Unlocks nothing, it just helps."), price: p.2) }
                    } else {
                        unavailable
                    }
                    #else
                    unavailable
                    #endif
                } else {
                    ForEach(jar.products, id: \.id) { p in
                        Button { Task { await jar.buy(p) } } label: {
                            row(emoji: emoji(p.id), name: p.displayName, description: p.description, price: p.displayPrice)
                        }
                    }
                }
                if let e = jar.error { Text(e).font(.footnote).foregroundStyle(.red) }
            }
            if jar.thanks {
                Section { Label(T("Danke! Das bedeutet mir viel.", "Thank you! That means a lot."), systemImage: "heart.fill").foregroundStyle(.pink) }
            }
        }
        .navigationTitle(T("Unterstützen", "Support"))
        .task { await jar.load() }
    }

    /// Der App Store hat (noch) keine Produkte geliefert – z. B. ohne Netz: erklären und neu laden lassen
    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(T("Die Trinkgeld-Optionen konnten gerade nicht vom App Store geladen werden.", "The tip options could not be loaded from the App Store right now."))
                .foregroundStyle(.secondary)
            Button { Task { await jar.load() } } label: { Label(T("Erneut versuchen", "Try again"), systemImage: "arrow.clockwise") }
        }.padding(.vertical, 4)
    }

    private func row(emoji: String, name: String, description: String, price: String) -> some View {
        HStack {
            Text(emoji).font(.title2)
            VStack(alignment: .leading) {
                Text(name).foregroundStyle(.primary)
                if !description.isEmpty { Text(description).font(.footnote).foregroundStyle(.secondary) }
            }
            Spacer()
            Text(price).bold()
        }
    }

    #if DEBUG
    private static let preview = [("small", T("Ein Kaffee", "A coffee"), "0,99 €"), ("medium", T("Ein Taschenbuch", "A paperback"), "2,99 €"), ("large", T("Ein Hardcover", "A hardcover"), "4,99 €")]
    #endif

    private func emoji(_ id: String) -> String {
        id.hasSuffix("small") ? "☕️" : id.hasSuffix("medium") ? "📚" : "💛"
    }
}
