package de.sgitaize.bookshelv

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Was die App gerade ist: noch nicht eingerichtet, lokale Bibliothek oder Konto auf einer Instanz (wie AppModel.swift).
 * Gespeichert in SharedPreferences „bookshelv“ (Teil der Google-Sicherung); die Daten selbst liegen beim App-Host.
 */
object AppModel {
    enum class Mode { NONE, LOCAL, REMOTE }
    enum class Panel { OVERVIEW, BACKUP, CONNECT, SWITCH, SUPPORT }

    /** Standard-Instanz für „Ich habe ein Konto“ (künftig bookshelv.de) */
    const val DEFAULT_INSTANCE = "https://bookshelv.aize-it.de"

    private lateinit var prefs: SharedPreferences

    var mode by mutableStateOf(Mode.NONE); private set
    var instance by mutableStateOf<String?>(null); private set
    var autoBackup by mutableStateOf(true); private set
    var lastBackup by mutableStateOf<Long?>(null); private set

    /** angemeldete Person laut Weboberfläche (null = abgemeldet / unbekannt) */
    var webUser by mutableStateOf<Pair<String, String>?>(null)
    /** Neuladen der WebView anstoßen */
    var reloadToken by mutableIntStateOf(0)
    var pendingPath by mutableStateOf<String?>(null)
    var panel by mutableStateOf<Panel?>(null)

    fun init(ctx: Context) {
        if (::prefs.isInitialized) return
        prefs = ctx.getSharedPreferences("bookshelv", Context.MODE_PRIVATE)
        mode = runCatching { Mode.valueOf(prefs.getString("mode", "NONE")!!) }.getOrDefault(Mode.NONE)
        instance = prefs.getString("instance", null)
        autoBackup = prefs.getBoolean("autoBackup", true)
        lastBackup = prefs.getLong("lastBackup", 0L).takeIf { it > 0 }
    }

    val instanceHost: String get() = instance?.let { runCatching { java.net.URI(it).host }.getOrNull() } ?: ""

    fun saveInstance(url: String?) { instance = url; prefs.edit().putString("instance", url).apply() }
    fun saveAutoBackup(on: Boolean) { autoBackup = on; prefs.edit().putBoolean("autoBackup", on).apply() }
    fun saveLastBackup(t: Long) { lastBackup = t; prefs.edit().putLong("lastBackup", t).apply() }

    /** Modus wechseln und die Oberfläche neu laden (optional gleich auf eine Seite) */
    fun switchTo(m: Mode, path: String? = null) {
        mode = m
        prefs.edit().putString("mode", m.name).apply()
        pendingPath = path
        webUser = null
        reloadToken++
    }
}
