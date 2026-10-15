import Foundation

/// Zweisprachige Texte direkt an der Stelle, an der sie gebraucht werden: T("Deutsch", "English").
/// Deutsch, wenn das Gerät Deutsch als bevorzugte Sprache hat, sonst Englisch (wie die Weboberfläche).
func T(_ de: String, _ en: String) -> String { L10n.isGerman ? de : en }

enum L10n {
    static let isGerman = Locale.preferredLanguages.first?.lowercased().hasPrefix("de") ?? false
    static var lang: String { isGerman ? "de" : "en" }
}
