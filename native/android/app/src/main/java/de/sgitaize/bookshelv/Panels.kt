package de.sgitaize.bookshelv

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FileOpen
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private const val REPO = "https://github.com/sgitaize/bookshelv"

/**
 * Native App-Einstellungen (aus der Weboberfläche: Einstellungen → App) – wie AppPanel.swift.
 * Alles, was die Seite selbst nicht kann: Sicherung, Konto verbinden (zusammenführen), Instanz wechseln, Unterstützen.
 */
@Composable
fun AppPanel(start: AppModel.Panel, close: () -> Unit) {
    val stack = remember { mutableStateListOf<AppModel.Panel>().apply { if (start != AppModel.Panel.OVERVIEW) add(start) } }
    val back: () -> Unit = { if (stack.isEmpty()) close() else stack.removeAt(stack.lastIndex) }
    var locked by remember { mutableStateOf(false) }   // Zusammenführen läuft
    BackHandler { if (!locked) back() }
    when (stack.lastOrNull()) {
        AppModel.Panel.BACKUP -> BackupPanel(back)
        AppModel.Panel.CONNECT -> ConnectPanel(back, close) { locked = it }
        AppModel.Panel.SWITCH -> SwitchPanel(back, close)
        AppModel.Panel.SUPPORT -> SupportPanel(back)
        else -> Overview(close) { stack.add(it) }
    }
}

@Composable
private fun Overview(close: () -> Unit, open: (AppModel.Panel) -> Unit) {
    val ctx = LocalContext.current
    val s = NodeHost.state
    Page("bookshelv", close, close = true) {
        Section {
            if (AppModel.mode == AppModel.Mode.LOCAL) {
                ListRow(Icons.Filled.PhoneAndroid, T("Bibliothek nur auf diesem Gerät", "Library on this device only"),
                    s?.summary?.let { T("${it.books} Bücher · ${it.read} gelesen · ${it.reviews} Bewertungen", "${it.books} books · ${it.read} read · ${it.reviews} reviews") })
            } else {
                ListRow(Icons.Filled.AccountCircle, T("Konto auf ${AppModel.instanceHost}", "Account on ${AppModel.instanceHost}"),
                    AppModel.webUser?.let { "${it.first} · @${it.second}" })
            }
        }
        Section {
            val chevron: @Composable () -> Unit = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.muted) }
            if (AppModel.mode == AppModel.Mode.LOCAL) {
                ListRow(Icons.Filled.Backup, T("Sicherung", "Backup"), trailing = chevron) { open(AppModel.Panel.BACKUP) }
                ListRow(Icons.Filled.Group, T("Mit Konto verbinden", "Connect an account"), trailing = chevron) { open(AppModel.Panel.CONNECT) }
            }
            ListRow(Icons.Filled.SwapHoriz, T("Instanz wechseln oder ohne Konto", "Switch instance or no account"), trailing = chevron) { open(AppModel.Panel.SWITCH) }
            ListRow(Icons.Filled.Favorite, T("bookshelv unterstützen", "Support bookshelv"), trailing = chevron) { open(AppModel.Panel.SUPPORT) }
        }
        Section(footer = "bookshelv ${BuildConfig.VERSION_NAME} · Simon Gutjahr") {
            ListRow(Icons.Filled.Code, T("Quellcode (MIT)", "Source code (MIT)")) { ctx.openUrl(REPO) }
            ListRow(Icons.Filled.PanTool, T("Datenschutz", "Privacy")) { ctx.openUrl("https://bookshelv.aize-it.de/privacy") }
        }
    }
}

fun android.content.Context.openUrl(url: String) {
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

// ---------- Sicherung ----------

@Composable
private fun BackupPanel(back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }
    var confirmRestore by remember { mutableStateOf(false) }
    val run: (suspend () -> Unit) -> Unit = { f -> scope.launch { message = null; try { f() } catch (e: Exception) { message = e.message } } }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) run { Backup.export(uri); message = T("Gespeichert.", "Saved.") }
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) run { Backup.restore(uri); AppModel.reloadToken++; message = T("Wiederhergestellt.", "Restored.") }
    }
    val fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
    Page(T("Sicherung", "Backup"), back) {
        Section(footer = T("Die App legt beim Verlassen (höchstens alle 15 Minuten) eine Kopie deiner Bibliothek an. Android nimmt sie in die Google-Sicherung deines Geräts auf (Einstellungen → Google → Sicherung) und spielt sie auf einem neuen Handy automatisch zurück.",
            "When you leave the app (at most every 15 minutes) it keeps a copy of your library. Android includes it in your device's Google backup (Settings → Google → Backup) and restores it on a new phone automatically.")) {
            ListRow(null, T("Automatisch sichern", "Back up automatically"), trailing = { Switch(AppModel.autoBackup, { AppModel.saveAutoBackup(it) }) }) { AppModel.saveAutoBackup(!AppModel.autoBackup) }
            AppModel.lastBackup?.let { Labeled(T("Zuletzt gesichert", "Last backup"), fmt.format(Date(it))) }
            ListRow(Icons.Filled.CloudUpload, T("Jetzt sichern", "Back up now"), enabled = !Backup.busy) { run { Backup.backupNow(); message = T("Gesichert.", "Backed up.") } }
        }
        Backup.info?.let { info ->
            Section(T("Auf dem Gerät", "On this device")) {
                Labeled(T("Stand", "Date"), fmt.format(Date(info.date)))
                Labeled(T("Gerät", "Device"), info.device)
                Labeled(T("Bücher", "Books"), "${info.books}")
                ListRow(Icons.Filled.Restore, T("Wiederherstellen", "Restore"), color = Palette.red, enabled = !Backup.busy) { confirmRestore = true }
            }
        }
        Section(footer = T("Eine Datei-Sicherung enthält die ganze Bibliothek ohne Cover (die lädt die App neu). Speichern kannst du sie z. B. in Google Drive oder Downloads.",
            "A file backup contains the whole library without covers (the app fetches them again). Save it to Google Drive, Downloads or anywhere you like.")) {
            ListRow(Icons.Filled.SaveAlt, T("Als Datei sichern …", "Save as file …"), enabled = !Backup.busy) { exportLauncher.launch(Backup.exportName()) }
            ListRow(Icons.Filled.FileOpen, T("Aus Datei wiederherstellen …", "Restore from file …"), enabled = !Backup.busy) { importLauncher.launch(arrayOf("*/*")) }
        }
        if (Backup.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        (message ?: Backup.lastError)?.let { Text(it, color = if (message == null) Palette.red else Palette.muted, modifier = Modifier.padding(horizontal = 4.dp)) }
    }
    if (confirmRestore) AlertDialog(
        onDismissRequest = { confirmRestore = false },
        title = { Text(T("Bibliothek ersetzen?", "Replace library?")) },
        text = { Text(T("Alles, was seit der Sicherung dazukam, geht verloren.", "Everything added since the backup will be lost.")) },
        confirmButton = { TextButton({ confirmRestore = false; run { Backup.restoreFromDevice(); AppModel.reloadToken++; message = T("Wiederhergestellt.", "Restored.") } }) {
            Text(T("Durch Sicherung ersetzen", "Replace with backup"), color = Palette.red) } },
        dismissButton = { TextButton({ confirmRestore = false }) { Text(T("Abbrechen", "Cancel")) } },
    )
}

// ---------- Instanz wechseln ----------

@Composable
private fun SwitchPanel(back: () -> Unit, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var signIn by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmLogout by remember { mutableStateOf(false) }
    val s = NodeHost.state
    if (signIn) {
        BackHandler { signIn = false }
        Page(T("Anmelden", "Sign in"), { signIn = false }) {
            AccountFlow(AccountStart.SIGN_IN) { url -> AppModel.saveInstance(url); AppModel.switchTo(AppModel.Mode.REMOTE); close() }
        }
        return
    }
    val check: @Composable (Boolean) -> Unit = { on -> if (on) Icon(Icons.Filled.Check, null, tint = Palette.accent) }
    Page(T("Wechseln", "Switch"), back) {
        Section(footer = if (AppModel.mode == AppModel.Mode.LOCAL && (s?.summary?.books ?: 0) > 0)
            T("Tipp: Willst du deine lokale Bibliothek mitnehmen, nutze „Mit Konto verbinden“ – das führt beide ohne Dubletten zusammen.",
              "Tip: to take your local library along, use “Connect an account” – it merges both without duplicates.") else null) {
            ListRow(Icons.Filled.PhoneAndroid, T("Ohne Konto (nur dieses Gerät)", "Without an account (this device only)"),
                if (s?.localExists == true) T("Deine lokale Bibliothek", "Your local library") else T("Neue, leere Bibliothek", "New, empty library"),
                enabled = !busy && AppModel.mode != AppModel.Mode.LOCAL, trailing = { check(AppModel.mode == AppModel.Mode.LOCAL) }) {
                scope.launch {
                    busy = true; error = null
                    try { NodeHost.startLocal(null); AppModel.switchTo(AppModel.Mode.LOCAL); close() } catch (e: Exception) { error = e.message }
                    busy = false
                }
            }
            val instance = AppModel.instance
            if (instance != null && s?.loggedIn == true) {
                ListRow(Icons.Filled.AccountCircle, T("Konto auf ${AppModel.instanceHost}", "Account on ${AppModel.instanceHost}"), instance,
                    enabled = AppModel.mode != AppModel.Mode.REMOTE, trailing = { check(AppModel.mode == AppModel.Mode.REMOTE) }) {
                    AppModel.switchTo(AppModel.Mode.REMOTE); close()
                }
            }
            ListRow(Icons.Filled.AddCircle, T("Bei einer Instanz anmelden …", "Sign in to an instance …"), T("Oder neues Konto bzw. Einladung", "Or new account / invitation")) { signIn = true }
        }
        if (s?.loggedIn == true) Section {
            ListRow(Icons.AutoMirrored.Filled.Logout, T("Von ${AppModel.instanceHost} abmelden", "Sign out of ${AppModel.instanceHost}"), color = Palette.red) { confirmLogout = true }
        }
        ErrorText(error)
    }
    if (confirmLogout) AlertDialog(
        onDismissRequest = { confirmLogout = false },
        title = { Text(T("Abmelden?", "Sign out?")) },
        text = { Text(T("Offline vorgemerkte Änderungen, die noch nicht übertragen wurden, gehen verloren.", "Offline changes that have not been sent yet will be lost.")) },
        confirmButton = { TextButton({
            confirmLogout = false
            scope.launch {
                NodeHost.logout()
                // ohne Konto weiter: lokale Bibliothek, sonst Startbildschirm
                AppModel.switchTo(if (NodeHost.state?.localExists == true) AppModel.Mode.LOCAL else AppModel.Mode.NONE)
                close()
            }
        }) { Text(T("Abmelden", "Sign out"), color = Palette.red) } },
        dismissButton = { TextButton({ confirmLogout = false }) { Text(T("Abbrechen", "Cancel")) } },
    )
}

// ---------- Mit Konto verbinden ----------

/**
 * Lokale Bibliothek mit einem Konto zusammenführen (wie ConnectView.swift): anmelden, Regeln wählen, als Import-Job zur
 * Instanz hochladen (Abgleich, keine Dubletten, rückgängig machbar), lokale Bibliothek archivieren, aufs Konto umschalten.
 */
@Composable
private fun ConnectPanel(back: () -> Unit, close: () -> Unit, lock: (Boolean) -> Unit) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf("account") }
    var instance by remember { mutableStateOf("") }
    var conflict by remember { mutableStateOf("ask") }
    var visibility by remember { mutableStateOf("instance") }
    var status by remember { mutableStateOf<NodeHost.MergeStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(step) { lock(step == "running") }

    fun startMerge() = scope.launch {
        busy = true; error = null
        try {
            // vorher noch einmal sichern – falls etwas schiefgeht, ist der Stand in der Sicherung
            if (AppModel.autoBackup) runCatching { Backup.backupNow() }
            val id = NodeHost.mergeStart(conflict, visibility, T("Bibliothek vom ${Build.MODEL}", "Library from ${Build.MODEL}"))
            if (id == null) { NodeHost.archiveLocal(); step = "done"; busy = false; return@launch }
            step = "running"
            while (true) {
                val st = NodeHost.mergeStatus(id)
                status = st
                if (st.status != "running") break
                delay(800)
            }
            if (status?.status != "done") throw NodeHost.HostError(T("Der Import wurde abgebrochen.", "The import was cancelled."))
            NodeHost.archiveLocal()
            step = "done"
        } catch (e: Exception) {
            error = e.message
            if (step == "running" && status == null) step = "options"
        }
        busy = false
    }

    Page(T("Mit Konto verbinden", "Connect an account"), if (step == "running") null else back) {
        when (step) {
            "account" -> AccountFlow(AccountStart.SIGN_IN, T("Melde dich bei der Instanz an, mit der du deine Bibliothek verbinden willst – oder lege dort ein Konto an.",
                "Sign in to the instance you want to connect your library to – or create an account there.")) { instance = it; step = "options" }
            "options" -> {
                val s = NodeHost.state?.summary
                Section(T("Wird übernommen", "Will be transferred"), T("Dazu Lesedaten, Fortschritt, Stimmungen, Top 5, Reihen, eigene Cover und gefolgte Autor*innen. Bücher, die schon in deinem Konto stehen, werden zusammengelegt – nicht verdoppelt.",
                    "Plus reading dates, progress, moods, top 5, series, custom covers and followed authors. Books already in your account are merged – not duplicated.")) {
                    if (s != null) {
                        Labeled(T("Bücher im Regal", "Books on shelf"), "${s.books}")
                        Labeled(T("Gelesen", "Read"), "${s.read}")
                        Labeled(T("Bewertungen", "Reviews"), "${s.reviews}")
                        Labeled(T("Wunschliste", "Wishlist"), "${s.wishlist}")
                        Labeled(T("Leselisten", "Reading lists"), "${s.lists}")
                        Labeled(T("Verliehen", "Lent out"), "${s.loans}")
                    }
                }
                Section(T("Bei Unterschieden", "When they differ"), T("Unterschiede gibt es, wenn ein Buch im Konto z. B. einen anderen Lesestand hat. „Nachfragen“ zeigt dir jeden Fall danach unter Importe.",
                    "They differ when, say, a book has a different reading status in your account. “Ask me” lists every case afterwards under Imports.")) {
                    for ((v, label) in listOf("ask" to T("Nachfragen", "Ask me"), "mine" to T("Konto behalten", "Keep account"), "theirs" to T("Vom Gerät übernehmen", "Take from device")))
                        ListRow(null, label, trailing = { RadioButton(conflict == v, { conflict = v }) }) { conflict = v }
                }
                Section(T("Bewertungen sichtbar für", "Reviews visible to")) {
                    for ((v, label) in listOf("instance" to T("Freund*innen", "Friends"), "private" to T("Nur mich", "Only me")))
                        ListRow(null, label, trailing = { RadioButton(visibility == v, { visibility = v }) }) { visibility = v }
                }
                PrimaryButton(T("Jetzt zusammenführen", "Merge now"), busy) { startMerge() }
                Text(T("Die lokale Bibliothek wird danach archiviert (eine Kopie bleibt in der Sicherung) und die App nutzt dein Konto. Der Import lässt sich im Konto unter Importe rückgängig machen.",
                    "Afterwards the local library is archived (a copy stays in the backup) and the app uses your account. The import can be undone in your account under Imports."),
                    fontSize = 13.sp, color = Palette.muted)
            }
            else -> Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                val st = status
                if (step == "done") {
                    Icon(Icons.Filled.CheckCircle, null, tint = Color(0xFF4CAF50), modifier = Modifier.size(64.dp))
                    Text(T("Zusammengeführt", "Merged"), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                } else {
                    LinearProgressIndicator({ if (st == null || st.total == 0) 0f else st.done.toFloat() / st.total }, Modifier.fillMaxWidth(0.8f))
                    Text(T("Übertrage deine Bibliothek …", "Transferring your library …"), fontWeight = FontWeight.SemiBold)
                    Text(T("Bitte die App geöffnet lassen.", "Please keep the app open."), fontSize = 13.sp, color = Palette.muted)
                }
                if (st != null) {
                    Text(T("${st.done} von ${st.total} Büchern", "${st.done} of ${st.total} books"))
                    Text(T("${st.ok} übernommen · ${st.exists} schon vorhanden", "${st.ok} transferred · ${st.exists} already there"), color = Palette.muted)
                    if (st.conflictCount > 0) Text(T("${st.conflictCount} Unterschiede zum Nachsehen", "${st.conflictCount} differences to review"), color = Color(0xFFE8A54B))
                    if (st.failed > 0) Text(T("${st.failed} nicht gefunden", "${st.failed} not found"), color = Palette.red)
                }
                ErrorText(error)
                if (step == "done") PrimaryButton(T("Zu meinem Konto", "Go to my account")) {
                    AppModel.saveInstance(instance)
                    AppModel.switchTo(AppModel.Mode.REMOTE, if ((st?.conflictCount ?: 0) > 0 || (st?.failed ?: 0) > 0) "/imports" else "/library")
                    close()
                }
            }
        }
        if (step == "options") ErrorText(error)
    }
}

// ---------- Unterstützen ----------

@Composable
private fun SupportPanel(back: () -> Unit) {
    val ctx = LocalContext.current
    Page(T("Unterstützen", "Support"), back) {
        Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("📚", fontSize = 48.sp)
            Text(T("bookshelv ist kostenlos – ohne Werbung, ohne Tracking, ohne Abo.", "bookshelv is free – no ads, no tracking, no subscription."),
                fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(if (Store.hasTips) T("Ich baue die App in meiner Freizeit. Wenn sie dir gefällt, freue ich mich über ein Trinkgeld – es schaltet nichts frei, es hilft einfach.",
                    "I build the app in my spare time. If you like it, a tip is much appreciated – it unlocks nothing, it simply helps.")
                else T("Ich baue die App in meiner Freizeit. Wenn sie dir gefällt, hilft es schon, sie weiterzuempfehlen.",
                    "I build the app in my spare time. If you like it, telling others already helps a lot."), color = Palette.muted, textAlign = TextAlign.Center)
        }
        // Trinkgeld je Vertriebsweg: Play Billing (Flavor „play“) bzw. optionaler Spendenlink (Download-APK)
        if (Store.hasTips) Section { Store.TipRows() }
        Section {
            ListRow(Icons.Filled.Share, T("App weiterempfehlen", "Recommend the app")) {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,
                    T("bookshelv – deine Bibliothek fürs Handy, ohne Konto und ohne Werbung: ", "bookshelv – your library on your phone, no account, no ads: ") + Store.SHARE_URL)
                ctx.startActivity(Intent.createChooser(send, null))
            }
            ListRow(Icons.Filled.Star, T("Auf GitHub einen Stern geben", "Star it on GitHub")) { ctx.openUrl(REPO) }
        }
    }
}
