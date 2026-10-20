package de.sgitaize.bookshelv

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Nur Download-APK (Flavor „github“, BuildConfig.UPDATE_CHECK): Die App aktualisiert sich nicht selbst.
 * Beim Start höchstens alle 12 Stunden das neueste GitHub-Release abfragen (ohne Tracking, nur diese eine Anfrage)
 * und bei einer neueren Version einen Hinweis zeigen. Wegtippen gilt für genau diese Version.
 */
object Updates {
    const val DOWNLOAD = "https://github.com/sgitaize/bookshelv/releases/latest/download/bookshelv.apk"
    private const val LATEST = "https://api.github.com/repos/sgitaize/bookshelv/releases/latest"
    private const val EVERY_MS = 12 * 3600_000L

    /** neuere Version (z. B. "1.0.1"), solange der Hinweis sichtbar sein soll */
    var available by mutableStateOf<String?>(null)
        private set

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("updates", Context.MODE_PRIVATE)

    fun check(ctx: Context, scope: CoroutineScope) {
        if (!BuildConfig.UPDATE_CHECK) return
        val p = prefs(ctx)
        if (System.currentTimeMillis() - p.getLong("checkedAt", 0) < EVERY_MS) { show(ctx, p.getString("latest", null)); return }
        scope.launch {
            val latest = withContext(Dispatchers.IO) { runCatching { fetchLatest() }.getOrNull() } ?: return@launch
            p.edit().putLong("checkedAt", System.currentTimeMillis()).putString("latest", latest).apply()
            show(ctx, latest)
        }
    }

    fun dismiss(ctx: Context) {
        available?.let { prefs(ctx).edit().putString("dismissed", it).apply() }
        available = null
    }

    private fun show(ctx: Context, latest: String?) {
        if (latest != null && newer(latest, BuildConfig.VERSION_NAME) && prefs(ctx).getString("dismissed", null) != latest) available = latest
    }

    /** Version des neuesten Releases mit APK (Tag „v1.2.3“ → „1.2.3“); Releases ohne bookshelv.apk zählen nicht */
    private fun fetchLatest(): String? {
        val c = URL(LATEST).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 8000
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.setRequestProperty("User-Agent", "bookshelv-android/${BuildConfig.VERSION_NAME}")
        try {
            if (c.responseCode != 200) return null
            val r = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            if (r.optBoolean("draft") || r.optBoolean("prerelease")) return null
            val assets = r.optJSONArray("assets") ?: return null
            if ((0 until assets.length()).none { assets.getJSONObject(it).optString("name") == "bookshelv.apk" }) return null
            return r.optString("tag_name").removePrefix("v").takeIf { it.isNotEmpty() }
        } finally { c.disconnect() }
    }

    /** a > b nach Zahlenteilen (1.10.0 > 1.9.3); Zusätze wie „-beta“ werden ignoriert */
    fun newer(a: String, b: String): Boolean {
        val pa = a.split('.', '-').map { it.toIntOrNull() ?: 0 }
        val pb = b.split('.', '-').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val x = pa.getOrElse(i) { 0 }; val y = pb.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }
}

/** Kleiner Hinweis oben über der Bibliothek: neue Version laden oder wegtippen */
@Composable
fun UpdateBanner(modifier: Modifier = Modifier) {
    val version = Updates.available ?: return
    val ctx = LocalContext.current
    Row(
        modifier.windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth()
            .background(Palette.surfaceHigh, RoundedCornerShape(14.dp)).padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(T("bookshelv $version ist da", "bookshelv $version is available"), color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text(T("Download über GitHub – Play-Store-Version folgt", "Download from GitHub – Play Store version coming soon"), color = Palette.muted, fontSize = 12.sp)
        }
        TextButton({ ctx.openUrl(Updates.DOWNLOAD); Updates.dismiss(ctx) }) { Text(T("Laden", "Download")) }
        IconButton({ Updates.dismiss(ctx) }) { Icon(Icons.Filled.Close, T("Schließen", "Close"), tint = Palette.muted) }
    }
}
