package de.sgitaize.bookshelv

import android.app.backup.BackupManager
import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Sicherung der lokalen Bibliothek (Gegenstück zu BackupManager.swift mit iCloud):
 *  - Schnappschuss in files/backup/ (VACUUM INTO im App-Host, Cover solange es passt, info.json). Nur dieser Ordner
 *    geht in die Google-Sicherung des Geräts (res/xml/data_extraction_rules.xml) – nie die offene Datenbank.
 *    Auf einem neuen Gerät stellt Android den Ordner wieder her und die App übernimmt ihn beim ersten Start.
 *  - Als Datei speichern / aus Datei wiederherstellen (Dateiauswahl: Google Drive, Downloads, Nextcloud …).
 */
object Backup {
    data class Info(val date: Long, val device: String, val books: Int, val read: Int, val size: Long, val appVersion: String)

    var busy by mutableStateOf(false); private set
    var info by mutableStateOf<Info?>(null); private set
    var lastError by mutableStateOf<String?>(null)

    /** Google-Sicherung erlaubt 25 MB je App – Cover nur, solange alles darunter bleibt (sie lassen sich neu laden) */
    private const val BUDGET = 22L * 1024 * 1024
    private lateinit var ctx: Context
    private val dir get() = File(ctx.filesDir, "backup")

    fun init(context: Context) {
        ctx = context.applicationContext
        info = readInfo()
    }

    private fun readInfo(): Info? = runCatching {
        val j = JSONObject(File(dir, "info.json").readText())
        if (!File(dir, "bookshelv.db").exists()) return null
        Info(j.getLong("date"), j.optString("device"), j.optInt("books"), j.optInt("read"), j.optLong("size"), j.optString("appVersion"))
    }.getOrNull()

    /** Automatisch beim Verlassen der App, höchstens alle 15 Minuten */
    suspend fun backupIfDue() {
        if (AppModel.mode != AppModel.Mode.LOCAL || !AppModel.autoBackup || busy) return
        val last = AppModel.lastBackup
        if (last != null && System.currentTimeMillis() - last < 15 * 60_000) return
        runCatching { backupNow() }
    }

    suspend fun backupNow() {
        if (busy) return
        busy = true; lastError = null
        try {
            val tmp = File(ctx.cacheDir, "snap-${UUID.randomUUID()}")
            try {
                val snap = NodeHost.snapshot(tmp)
                withContext(Dispatchers.IO) {
                    dir.mkdirs()
                    val db = File(tmp, "bookshelv.db")
                    val target = File(dir, "bookshelv.db")
                    val part = File(dir, "bookshelv.db.part")
                    db.copyTo(part, overwrite = true)
                    if (!part.renameTo(target)) throw NodeHost.HostError(T("Sicherung konnte nicht geschrieben werden.", "Could not write the backup."))
                    var used = target.length()
                    for (sub in listOf("avatars", "covers")) used = mirror(File(NodeHost.dataDir, sub), File(dir, sub), used)
                    val i = Info(System.currentTimeMillis(), deviceName(), snap.summary?.books ?: 0, snap.summary?.read ?: 0, snap.size, BuildConfig.VERSION_NAME)
                    File(dir, "info.json").writeText(JSONObject().put("date", i.date).put("device", i.device).put("books", i.books)
                        .put("read", i.read).put("size", i.size).put("appVersion", i.appVersion).toString(2))
                    info = i
                }
                AppModel.saveLastBackup(System.currentTimeMillis())
                BackupManager(ctx).dataChanged()
            } finally {
                tmp.deleteRecursively()
            }
        } catch (e: Exception) {
            lastError = e.message
            throw e
        } finally {
            busy = false
        }
    }

    /** Ordner spiegeln: neue Dateien hinüber (solange das Budget reicht), gelöschte entfernen. Cover-Namen sind eindeutig. */
    private fun mirror(from: File, to: File, usedBefore: Long): Long {
        to.mkdirs()
        var used = usedBefore
        val src = (from.listFiles() ?: emptyArray()).filter { it.isFile && !it.name.startsWith(".") }.associateBy { it.name }
        for (f in to.listFiles() ?: emptyArray()) if (f.name !in src) f.delete() else used += f.length()
        for ((name, f) in src) {
            val t = File(to, name)
            if (t.exists()) continue
            if (used + f.length() > BUDGET) continue
            f.copyTo(t); used += f.length()
        }
        return used
    }

    /** Schnappschuss als lokale Bibliothek übernehmen (ersetzt die aktuelle!) – z. B. nach der Google-Wiederherstellung */
    suspend fun restoreFromDevice() = guarded {
        val tmp = File(ctx.cacheDir, "restore-${UUID.randomUUID()}")
        try {
            withContext(Dispatchers.IO) { dir.copyRecursively(tmp, overwrite = true); File(tmp, "info.json").delete() }
            NodeHost.restore(tmp)
        } finally { tmp.deleteRecursively() }
    }

    /** Sicherung aus einer Datei (.db): prüfen lässt sie der Host, er übernimmt sie nur, wenn sie eine bookshelv-Datenbank ist */
    suspend fun restore(uri: Uri) = guarded {
        val tmp = File(ctx.cacheDir, "restore-${UUID.randomUUID()}").apply { mkdirs() }
        try {
            withContext(Dispatchers.IO) {
                ctx.contentResolver.openInputStream(uri)?.use { input -> File(tmp, "bookshelv.db").outputStream().use { input.copyTo(it) } }
                    ?: throw NodeHost.HostError(T("Datei lässt sich nicht öffnen.", "Cannot open the file."))
            }
            NodeHost.restore(tmp)
        } finally { tmp.deleteRecursively() }
    }

    /** Sicherung als Datei an den gewählten Ort schreiben (nur Datenbank – Cover holt sich die App neu) */
    suspend fun export(uri: Uri) = guarded {
        val tmp = File(ctx.cacheDir, "export-${UUID.randomUUID()}")
        try {
            NodeHost.snapshot(tmp)
            withContext(Dispatchers.IO) {
                ctx.contentResolver.openOutputStream(uri, "wt")?.use { out -> File(tmp, "bookshelv.db").inputStream().use { it.copyTo(out) } }
                    ?: throw NodeHost.HostError(T("Datei lässt sich nicht schreiben.", "Cannot write the file."))
            }
        } finally { tmp.deleteRecursively() }
    }

    fun exportName(): String = "bookshelv-" + SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date()) + ".db"

    private suspend fun guarded(f: suspend () -> Unit) {
        if (busy) return
        busy = true; lastError = null
        try { f() } catch (e: Exception) { lastError = e.message; throw e } finally { busy = false }
    }

    private fun deviceName(): String = listOf(Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, Build.MODEL)
        .distinct().joinToString(" ").let { if (Build.MODEL.startsWith(Build.MANUFACTURER, ignoreCase = true)) Build.MODEL else it }
}
