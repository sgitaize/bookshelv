package de.sgitaize.bookshelv

import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Drafts
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/**
 * Erster Start (wie OnboardingView.swift): Standard ist eine Bibliothek nur auf dem Gerät (kein Konto, kein Server).
 * Wer zu einer Instanz gehört, meldet sich an oder löst einen Einladungslink ein. Liegt eine Gerätesicherung vor
 * (neues Handy, Google-Sicherung), wird sie angeboten.
 */
@Composable
fun Onboarding() {
    var route by remember { mutableStateOf<String?>(null) }
    BackHandler(route != null) { route = null }
    when (route) {
        "local" -> LocalStep { route = null }
        "account" -> Page(T("Anmelden", "Sign in"), { route = null }) { AccountFlow(start = AccountStart.SIGN_IN) { finishRemote(it) } }
        "invite" -> Page(T("Einladung", "Invitation"), { route = null }) { AccountFlow(start = AccountStart.INVITE) { finishRemote(it) } }
        else -> Welcome { route = it }
    }
}

private fun finishRemote(url: String) {
    AppModel.saveInstance(url)
    AppModel.switchTo(AppModel.Mode.REMOTE)
}

@Composable
private fun Welcome(go: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmRestore by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Palette.background).safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(28.dp)) {
            Hero()
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Choice(Icons.Filled.PhoneAndroid, T("Ohne Konto loslegen", "Start without an account"),
                    T("Deine Bibliothek liegt nur auf diesem Gerät. Gesichert über die Google-Sicherung deines Handys.",
                      "Your library stays on this device. Backed up with your phone's Google backup."), primary = true) { go("local") }
                Choice(Icons.Filled.AccountCircle, T("Ich habe ein Konto", "I have an account"),
                    T("Bei bookshelv.aize-it.de oder einer anderen Instanz – deine Bibliothek ist dann auch unterwegs da.",
                      "On bookshelv.aize-it.de or another instance – your library comes along offline too.")) { go("account") }
                Choice(Icons.Filled.Drafts, T("Ich habe eine Einladung", "I have an invitation"),
                    T("Mit dem Link von Freund*innen ein Konto erstellen.", "Create an account with a link from a friend.")) { go("invite") }
            }
            Backup.info?.let { info ->
                Row(Modifier.fillMaxWidth().background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(16.dp))
                    .clickable(enabled = !busy) { confirmRestore = true }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Icon(Icons.Filled.Restore, null, tint = Palette.text, modifier = Modifier.size(28.dp))
                    Column(Modifier.weight(1f)) {
                        Text(T("Sicherung gefunden", "Backup found"), fontWeight = FontWeight.SemiBold, color = Palette.text)
                        Text(T("${info.books} Bücher", "${info.books} books") + " · ${info.device} · " +
                            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(info.date)), fontSize = 14.sp, color = Palette.muted)
                    }
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.muted)
                }
            }
            Text(T("Freund*innen, Leihanfragen und Leserunden gibt es mit einem Konto. Du kannst die lokale Bibliothek jederzeit mit einem Konto verbinden – ohne doppelte Bücher.",
                   "Friends, loan requests and buddy reads need an account. You can connect your local library to an account any time – without duplicates."),
                fontSize = 13.sp, color = Palette.muted, textAlign = TextAlign.Center)
            ErrorText(error)
        }
    }
    if (confirmRestore) AlertDialog(
        onDismissRequest = { confirmRestore = false },
        title = { Text(T("Sicherung wiederherstellen?", "Restore backup?")) },
        text = { Text(T("Die Bibliothek aus der Sicherung wird auf diesem Gerät eingerichtet.", "The library from the backup is set up on this device.")) },
        confirmButton = { TextButton(onClick = {
            confirmRestore = false
            scope.launch {
                busy = true; error = null
                try { Backup.restoreFromDevice(); AppModel.switchTo(AppModel.Mode.LOCAL) } catch (e: Exception) { error = e.message }
                busy = false
            }
        }) { Text(T("Wiederherstellen", "Restore")) } },
        dismissButton = { TextButton(onClick = { confirmRestore = false }) { Text(T("Abbrechen", "Cancel")) } },
    )
}

@Composable
private fun Hero() {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(top = 30.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(38, 52, 44, 60, 36, 48).forEachIndexed { i, h ->
                Box(Modifier.width(14.dp).height(h.dp).background(Palette.spines[i], RoundedCornerShape(3.dp)))
            }
        }
        Text("bookshelv", fontSize = 40.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = Color.White)
        Text(T("Deine Bücher. Gelesen, geliehen, geliebt.", "Your books. Read, lent, loved."), fontSize = 19.sp, fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = 0.75f), textAlign = TextAlign.Center)
    }
}

@Composable
private fun Choice(icon: ImageVector, title: String, text: String, primary: Boolean = false, onClick: () -> Unit) {
    val fg = if (primary) Color.Black else Color.White
    Row(Modifier.fillMaxWidth()
        .background(if (primary) Palette.accent else Color.White.copy(alpha = 0.08f), RoundedCornerShape(16.dp))
        .then(if (primary) Modifier else Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(16.dp)))
        .clickable(onClick = onClick).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(28.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = fg)
            Text(text, fontSize = 14.sp, color = fg.copy(alpha = 0.8f))
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = fg.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.CenterVertically))
    }
}

@Composable
private fun LocalStep(back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val create = {
        scope.launch {
            busy = true; error = null
            try {
                NodeHost.startLocal(name.trim().ifEmpty { null })
                AppModel.switchTo(AppModel.Mode.LOCAL, "/add")
            } catch (e: Exception) { error = e.message }
            busy = false
        }
        Unit
    }
    Page(T("Ohne Konto", "Without an account"), back) {
        Section(footer = T("Erscheint nur bei dir – z. B. auf dem Teilen-Bild deiner Lesestatistik.", "Only shown to you – e.g. on the shareable image of your reading stats.")) {
            Field(name, { name = it }, T("Dein Name (optional)", "Your name (optional)"), imeAction = ImeAction.Done, onDone = create, capitalize = true)
        }
        PrimaryButton(T("Bibliothek anlegen", "Create library"), busy, onClick = create)
        ErrorText(error)
    }
}

enum class AccountStart { SIGN_IN, INVITE }

/**
 * Instanz wählen und anmelden/registrieren (wie AccountFlow.swift). Die Sitzung landet im App-Host
 * (er hält das Cookie der Instanz); `onDone` bekommt die Instanz-Adresse.
 */
@Composable
fun AccountFlow(start: AccountStart, intro: String? = null, onDone: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf(AppModel.instance ?: AppModel.DEFAULT_INSTANCE) }
    var inviteLink by remember { mutableStateOf("") }
    var probe by remember { mutableStateOf<NodeHost.Probe?>(null) }
    var register by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var password2 by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    /** „https://host/invite/TOKEN“ → (https://host, TOKEN) */
    fun invite(): Pair<String, String>? = runCatching {
        val u = java.net.URI(inviteLink.trim())
        val parts = u.path.trim('/').split('/')
        if (u.host == null || parts.size < 2 || parts[0] != "invite") null
        else "${u.scheme ?: "https"}://${u.host}${if (u.port > 0) ":${u.port}" else ""}" to parts[1]
    }.getOrNull()

    fun check() = scope.launch {
        busy = true; error = null
        try {
            val url = if (start == AccountStart.INVITE) invite()?.first ?: "" else address
            val p = NodeHost.probe(url)
            if (p.status.needsSetup) throw NodeHost.HostError(T("Diese Instanz ist noch nicht eingerichtet.", "This instance is not set up yet."))
            NodeHost.useInstance(p.url)
            // schon angemeldet (z. B. nach einem Wechsel hin und zurück)?
            if (start == AccountStart.SIGN_IN && NodeHost.remoteMe() != null) { busy = false; onDone(p.url); return@launch }
            probe = p
            register = start == AccountStart.INVITE
        } catch (e: Exception) { error = e.message }
        busy = false
    }

    fun submit() = scope.launch {
        val p = probe ?: return@launch
        if (register && password != password2) { error = T("Die Passwörter stimmen nicht überein.", "Passwords do not match."); return@launch }
        busy = true; error = null
        try {
            NodeHost.signIn(username.trim(), password, register, displayName, if (start == AccountStart.INVITE) invite()?.second else null)
            busy = false
            onDone(p.url)
        } catch (e: Exception) { error = e.message; busy = false }
    }

    if (intro != null) Text(intro, color = Palette.muted)
    val p = probe
    if (p == null) {
        if (start == AccountStart.INVITE) {
            Section(T("Einladung", "Invitation"), T("Den Link hast du von jemandem bekommen, der schon bookshelv nutzt.", "You got the link from someone who already uses bookshelv.")) {
                Field(inviteLink, { inviteLink = it }, T("Einladungslink einfügen", "Paste invitation link"), keyboard = KeyboardType.Uri, imeAction = ImeAction.Go, onDone = { check() })
                if (inviteLink.isEmpty()) ListRow(Icons.Filled.ContentPaste, T("Einfügen", "Paste")) {
                    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    inviteLink = cm.primaryClip?.getItemAt(0)?.coerceToText(ctx)?.toString()?.trim() ?: ""
                }
            }
        } else {
            Section(T("Adresse der Instanz", "Instance address"), T("Eine Instanz ist ein bookshelv-Server, z. B. für deinen Freundeskreis.", "An instance is a bookshelv server, e.g. for your circle of friends.")) {
                Field(address, { address = it }, "bookshelv.aize-it.de", keyboard = KeyboardType.Uri, imeAction = ImeAction.Go, onDone = { check() })
            }
        }
        PrimaryButton(T("Weiter", "Continue"), busy, enabled = if (start == AccountStart.INVITE) invite() != null else address.isNotBlank()) { check() }
    } else {
        Section {
            Labeled(T("Instanz", "Instance"), runCatching { java.net.URI(p.url).host }.getOrNull() ?: p.url)
            if (start == AccountStart.SIGN_IN && p.status.openRegistration) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
                    SegmentedButton(!register, { register = false }, SegmentedButtonDefaults.itemShape(0, 2)) { Text(T("Anmelden", "Sign in")) }
                    SegmentedButton(register, { register = true }, SegmentedButtonDefaults.itemShape(1, 2)) { Text(T("Neues Konto", "New account")) }
                }
            }
        }
        Section(footer = if (register) T("3–32 Zeichen: Buchstaben, Ziffern, . _ -  · Passwort mindestens 8 Zeichen. Keine E-Mail-Adresse nötig.",
            "3–32 characters: letters, digits, . _ -  · Password at least 8 characters. No email needed.") else null) {
            Field(username, { username = it }, T("Anmeldename", "Username"))
            if (register) Field(displayName, { displayName = it }, T("Anzeigename (optional)", "Display name (optional)"), capitalize = true)
            Field(password, { password = it }, T("Passwort", "Password"), password = true,
                imeAction = if (register) ImeAction.Next else ImeAction.Done, onDone = { if (!register) submit() })
            if (register) Field(password2, { password2 = it }, T("Passwort wiederholen", "Repeat password"), password = true, imeAction = ImeAction.Done, onDone = { submit() })
        }
        PrimaryButton(if (register) T("Konto erstellen", "Create account") else T("Anmelden", "Sign in"), busy,
            enabled = username.trim().length >= 3 && password.isNotEmpty()) { submit() }
        TextButton(onClick = { probe = null; error = null }, enabled = !busy) { Text(T("Andere Instanz", "Other instance")) }
    }
    ErrorText(error)
}
