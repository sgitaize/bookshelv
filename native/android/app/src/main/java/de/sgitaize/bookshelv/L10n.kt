package de.sgitaize.bookshelv

import java.util.Locale

/** Zweisprachige Texte direkt an der Stelle, an der sie gebraucht werden: T("Deutsch", "English") – wie bei iOS. */
fun T(de: String, en: String): String = if (L10n.isGerman) de else en

object L10n {
    val isGerman: Boolean get() = Locale.getDefault().language == "de"
    val lang: String get() = if (isGerman) "de" else "en"
}
