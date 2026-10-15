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
                    Text(T("Trinkgeld ist gerade nicht verfügbar.", "Tips are not available right now.")).foregroundStyle(.secondary)
                } else {
                    ForEach(jar.products, id: \.id) { p in
                        Button { Task { await jar.buy(p) } } label: {
                            HStack {
                                Text(emoji(p.id)).font(.title2)
                                VStack(alignment: .leading) {
                                    Text(p.displayName).foregroundStyle(.primary)
                                    if !p.description.isEmpty { Text(p.description).font(.footnote).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                Text(p.displayPrice).bold()
                            }
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

    private func emoji(_ id: String) -> String {
        id.hasSuffix("small") ? "☕️" : id.hasSuffix("medium") ? "📚" : "💛"
    }
}
