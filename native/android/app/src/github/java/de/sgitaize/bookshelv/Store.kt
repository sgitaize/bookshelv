package de.sgitaize.bookshelv

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Download-APK aus den GitHub-Releases (ohne Google-Bibliotheken): Updates über den Hinweis beim Start (Updates.kt),
 * Trinkgeld höchstens über einen externen Spendenlink. Gegenstück für Google Play: src/play/…/Store.kt.
 */
object Store {
    /** Spendenlink außerhalb eines Stores (leer = kein Trinkgeld-Eintrag) */
    private const val DONATE_URL = ""

    /** Link zum Weiterempfehlen */
    const val SHARE_URL = Updates.DOWNLOAD

    val hasTips get() = DONATE_URL.isNotEmpty()

    @Composable
    fun TipRows() {
        val ctx = LocalContext.current
        if (DONATE_URL.isNotEmpty()) ListRow(Icons.Filled.Favorite, T("Trinkgeld geben", "Leave a tip")) { ctx.openUrl(DONATE_URL) }
    }
}
