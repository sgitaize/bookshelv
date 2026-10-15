package de.sgitaize.bookshelv

import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color as AColor
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Vollflächige Bibliothek (Weboberfläche); davor beim ersten Start der Willkommensbildschirm,
 * darüber nur native Teile: Scanner, App-Einstellungen (wie BookshelvApp.swift / RootView).
 */
class MainActivity : ComponentActivity() {
    private var library: LibraryWeb? = null
    private var loadedMode: AppModel.Mode? = null
    private var loadedToken = -1
    private var pageColor by mutableStateOf(Palette.background)
    private var lightPage by mutableStateOf(false)
    /** Sicherung beim Verlassen soll auch laufen, wenn die Activity schon weg ist */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val filePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { library?.deliverFile(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(AColor.TRANSPARENT), SystemBarStyle.dark(AColor.TRANSPARENT))
        super.onCreate(savedInstanceState)
        AppModel.init(applicationContext)
        Backup.init(applicationContext)
        Haptics.init(applicationContext)

        // Neues Gerät nach Google-Wiederherstellung: Modus „lokal“, aber nur der Schnappschuss ist da → nach dem Start übernehmen
        val restoreFromBackup = AppModel.mode == AppModel.Mode.LOCAL && !File(filesDir, "bookshelv/library/bookshelv.db").exists() && Backup.info != null
        NodeHost.start(applicationContext, startLocal = AppModel.mode == AppModel.Mode.LOCAL && !restoreFromBackup)
        lifecycleScope.launch {
            if (NodeHost.waitReady()) {
                NodeHost.setLanguage(L10n.lang)
                if (restoreFromBackup) {
                    runCatching { Backup.restoreFromDevice() }.onFailure { runCatching { NodeHost.startLocal(null) } }
                    AppModel.reloadToken++
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = library?.web
                when {
                    ScanSession.request != null -> ScanSession.close()
                    w != null && AppModel.mode != AppModel.Mode.NONE && w.canGoBack() -> w.goBack()
                    else -> moveTaskToBack(true)
                }
            }
        })

        setContent { BookshelvTheme { Root() } }
        handleIntent(intent)
    }

    @Composable
    private fun Root() {
        val failure = NodeHost.failure
        Box(Modifier.fillMaxSize().background(if (AppModel.mode == AppModel.Mode.NONE || !NodeHost.ready) Palette.background else pageColor)) {
            when {
                failure != null -> Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("📚", fontSize = 56.sp)
                    Text(failure, color = Color.White, textAlign = TextAlign.Center)
                }
                !NodeHost.ready -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
                AppModel.mode == AppModel.Mode.NONE -> Onboarding()
                else -> LibraryView()
            }
            ScanSession.request?.let { r -> ScannerScreen(r.multi) }
        }
        AppModel.panel?.let { p ->
            Dialog(onDismissRequest = { AppModel.panel = null }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
                Box(Modifier.fillMaxSize().background(Palette.background).windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))) {
                    AppPanel(p) { AppModel.panel = null }
                }
            }
        }
        // Statusleiste passend zur Seite (helle Themes → dunkle Symbole)
        val light = lightPage && AppModel.mode != AppModel.Mode.NONE && ScanSession.request == null
        LaunchedEffect(light) {
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = light; isAppearanceLightNavigationBars = light
            }
        }
    }

    @Composable
    private fun LibraryView() {
        AndroidView(
            factory = { ensureLibrary().web.also { (it.parent as? android.view.ViewGroup)?.removeView(it) } },
            modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout).union(WindowInsets.ime)),
            update = { if (loadedMode != AppModel.mode || loadedToken != AppModel.reloadToken) loadLibrary() },
        )
    }

    private fun ensureLibrary(): LibraryWeb = library ?: LibraryWeb(this).also { library = it }

    /** `window.bookshelvApp` für die Seite (web/src/lib/app.svelte.ts) und laden */
    private fun loadLibrary() {
        val lib = ensureLibrary()
        val remote = AppModel.mode == AppModel.Mode.REMOTE
        if (loadedMode != null && loadedMode != AppModel.mode) {
            // anderer Modus = andere Origin → Verlauf nicht mischen
            lib.web.clearHistory()
        }
        loadedMode = AppModel.mode
        loadedToken = AppModel.reloadToken
        val info = JSONObject()
            .put("platform", "android")
            .put("mode", if (remote) "remote" else "local")
            .put("instance", if (remote) AppModel.instance ?: JSONObject.NULL else JSONObject.NULL)
            .put("version", BuildConfig.VERSION_NAME)
            .put("scanner", ScanSession.isAvailable(this))
        lib.load(if (remote) NodeHost.remoteUrl else NodeHost.localUrl, info, AppModel.pendingPath)
        lib.web.post { lib.web.clearHistory() }
    }

    fun recreateWeb() {
        library?.destroy()
        library = null
        loadedMode = null
        AppModel.reloadToken++
    }

    fun hasCamera() = checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    fun pickFile(types: Array<String>) {
        runCatching { filePicker.launch(types) }.onFailure { library?.deliverFile(null) }
    }

    /** Nachrichten der Weboberfläche (Gegenstück: web/src/lib/app.svelte.ts) */
    fun onWebMessage(json: String) {
        val m = runCatching { JSONObject(json) }.getOrNull() ?: return
        when (m.optString("a")) {
            "haptic" -> Haptics.play(m.optString("k", "light"))
            "panel" -> AppModel.panel = runCatching { AppModel.Panel.valueOf(m.optString("s", "overview").uppercase()) }.getOrDefault(AppModel.Panel.OVERVIEW)
            "scan" -> if (ScanSession.isAvailable(this)) ScanSession.open(m.optInt("id"), m.optBoolean("multi"))
                      else Web.dispatch(JSONObject().put("type", "scanClosed").put("id", m.optInt("id")))
            "scanFeedback" -> ScanSession.show(m.optString("text"), m.optString("kind", "ok"))
            "session" -> {
                val u = m.optJSONObject("user")
                AppModel.webUser = u?.let { it.optString("name") to it.optString("username") }
                AppModel.pendingPath = null
                m.optString("lang").takeIf { it.isNotEmpty() }?.let { lifecycleScope.launch { NodeHost.setLanguage(it) } }
            }
            "theme" -> theme(m.optString("c"))
            "share" -> library?.shareFromPage(m)
        }
    }

    private fun theme(css: String) {
        val c = runCatching { Color(AColor.parseColor(css.trim())) }.getOrNull() ?: return
        pageColor = c
        lightPage = (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) > 0.6
        window.decorView.setBackgroundColor(c.toArgb())
    }

    override fun onResume() {
        super.onResume()
        if (!NodeHost.ready) return
        lifecycleScope.launch {
            NodeHost.waitReady(8000)
            NodeHost.refresh()
            Web.dispatch(JSONObject().put("type", "refresh"))
        }
    }

    override fun onStop() {
        super.onStop()
        appScope.launch { Backup.backupIfDue() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** „Öffnen mit bookshelv“ / Teilen einer CSV-Datei (Export aus Booky, Goodreads, StoryGraph …) → Import-Seite */
    private fun handleIntent(intent: Intent?) {
        val uri: Uri = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> @Suppress("DEPRECATION") (intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)
            else -> null
        } ?: return
        lifecycleScope.launch {
            val (name, text) = withContext(Dispatchers.IO) {
                val bytes = runCatching { contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: return@withContext null
                val name = runCatching {
                    contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                        if (c.moveToFirst()) c.getString(0) else null
                    }
                }.getOrNull() ?: uri.lastPathSegment ?: "import.csv"
                val utf8 = String(bytes, Charsets.UTF_8)
                name to (if (utf8.contains('�')) String(bytes, Charsets.ISO_8859_1) else utf8)
            } ?: return@launch
            if (AppModel.mode == AppModel.Mode.NONE) return@launch
            Web.dispatch(JSONObject().put("type", "file").put("name", name).put("text", text))
        }
        setIntent(Intent())
    }
}
