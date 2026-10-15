package de.sgitaize.bookshelv

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.util.UUID

/**
 * Eingebettetes Node (nodejs-mobile) mit dem App-Host `server/host.js` (Quelle: server/src/mobile/host.ts) – wie NodeHost.swift.
 *
 * Drei Ports auf 127.0.0.1: Steuerung (nur diese Klasse, mit Token), Lokal (Bibliothek auf dem Gerät) und Instanz
 * (Oberfläche aus dem APK, API zur gewählten Instanz). Feste Wunsch-Ports, damit die Origins – und damit localStorage/
 * Offline-Cache der WebView – über App-Starts hinweg gleich bleiben.
 */
object NodeHost {
    init {
        System.loadLibrary("node")
        System.loadLibrary("bsnode")   // registriert dabei bookshelv_sqlite (Konstruktor in sqlite_napi.c)
    }

    private external fun startNode(script: String, env: Array<String>): Int

    data class Summary(val books: Int, val read: Int, val reviews: Int, val wishlist: Int, val lists: Int, val loans: Int, val name: String?)
    data class State(val version: String, val localRunning: Boolean, val localExists: Boolean, val summary: Summary?, val remoteUrl: String?, val loggedIn: Boolean)
    data class InstanceStatus(val openRegistration: Boolean, val needsSetup: Boolean)
    data class Probe(val url: String, val status: InstanceStatus)
    data class Snapshot(val file: String, val size: Long, val summary: Summary?)
    data class MergeStatus(val status: String, val total: Int, val done: Int, val ok: Int, val exists: Int, val failed: Int, val conflictCount: Int)

    class HostError(message: String) : Exception(message)

    var ready by mutableStateOf(false); private set
    var state by mutableStateOf<State?>(null); private set
    var failure by mutableStateOf<String?>(null); private set

    private val ports by lazy { freePorts(8470, 3) }
    val controlPort get() = ports[0]
    val localPort get() = ports[1]
    val remotePort get() = ports[2]
    /** Steuer-Token und zugleich Anmeldung im Lokal-Modus (Cookie bs_app); je Start neu */
    val token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "")
    @Volatile private var started = false

    val localUrl get() = "http://127.0.0.1:$localPort/"
    val remoteUrl get() = "http://127.0.0.1:$remotePort/"

    lateinit var dataDir: File; private set   // lokale Bibliothek (bookshelv.db, covers/, avatars/)
    lateinit var varDir: File; private set    // Host-Zustand (Sitzung der Instanz, Cover-Cache, Archiv)

    /** Entpackt Oberfläche + Host bei neuer App-Version nach filesDir/server und startet Node in einem eigenen Thread. */
    fun start(ctx: Context, startLocal: Boolean) {
        if (started) return
        started = true
        val root = File(ctx.filesDir, "bookshelv")
        dataDir = File(root, "library").apply { mkdirs() }
        varDir = File(root, "host").apply { File(this, "cache").mkdirs() }
        val server = File(ctx.filesDir, "server")
        val stamp = File(ctx.filesDir, "server.version")
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val version = "${BuildConfig.VERSION_CODE}-${info.lastUpdateTime}"
        if (!server.exists() || !stamp.exists() || stamp.readText() != version) {
            server.deleteRecursively()
            copyAssets(ctx, "server", server)
            stamp.writeText(version)
        }
        val env = arrayOf(
            "BS_TOKEN=$token",
            "BS_CONTROL_PORT=$controlPort",
            "BS_LOCAL_PORT=$localPort",
            "BS_REMOTE_PORT=$remotePort",
            "BS_DATA=${dataDir.absolutePath}",
            "BS_VAR=${varDir.absolutePath}",
            "BS_PUBLIC=${File(server, "public").absolutePath}",
            "BS_VERSION=${BuildConfig.VERSION_NAME}",
            "BS_START_LOCAL=${if (startLocal) "1" else "0"}",
            "NODE_NO_WARNINGS=1",
            "TMPDIR=${ctx.cacheDir.absolutePath}",
            "HOME=${root.absolutePath}",
        )
        Thread(null, {
            val rc = startNode(File(server, "host.js").absolutePath, env)
            failure = T("Der App-Dienst wurde beendet ($rc).", "The app service stopped ($rc).")
        }, "node", 16L * 1024 * 1024).start()
    }

    /** Wartet, bis der Host antwortet (beim Start und nach dem Aufwachen) */
    suspend fun waitReady(timeoutMs: Long = 25_000): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            val s = runCatching { fetchState(2000) }.getOrNull()
            if (s != null) { state = s; ready = true; return true }
            if (failure != null) return false
            delay(150)
        }
        if (!ready) failure = T("Der App-Dienst startet nicht.", "The app service does not start.")
        return false
    }

    suspend fun refresh() { runCatching { fetchState(10_000) }.getOrNull()?.let { state = it } }

    private suspend fun fetchState(timeout: Int): State {
        val j = call("GET", "state", null, timeout)
        val l = j.getJSONObject("local")
        val r = j.getJSONObject("remote")
        return State(
            version = j.optString("version"),
            localRunning = l.optBoolean("running"), localExists = l.optBoolean("exists"),
            summary = l.optJSONObject("summary")?.let(::summary),
            remoteUrl = r.optString("url").takeIf { !r.isNull("url") && it.isNotEmpty() },
            loggedIn = r.optBoolean("loggedIn"),
        )
    }

    private fun summary(s: JSONObject) = Summary(
        s.optInt("books"), s.optInt("read"), s.optInt("reviews"), s.optInt("wishlist"), s.optInt("lists"), s.optInt("loans"),
        s.optString("name").takeIf { !s.isNull("name") && it.isNotEmpty() },
    )

    // ---------- Lokal ----------

    suspend fun startLocal(name: String?): Summary? {
        val r = call("POST", "local/start", JSONObject().put("name", name ?: JSONObject.NULL), 30_000)
        refresh()
        return r.optJSONObject("summary")?.let(::summary)
    }

    suspend fun snapshot(dir: File): Snapshot {
        val r = call("POST", "local/snapshot", JSONObject().put("dir", dir.absolutePath), 60_000)
        return Snapshot(r.getString("file"), r.optLong("size"), r.optJSONObject("summary")?.let(::summary))
    }

    suspend fun restore(dir: File): Summary? {
        val r = call("POST", "local/restore", JSONObject().put("dir", dir.absolutePath), 120_000)
        refresh()
        return r.optJSONObject("summary")?.let(::summary)
    }

    suspend fun archiveLocal(): String {
        val r = call("POST", "local/archive", JSONObject(), 120_000)
        refresh()
        return r.optString("archive")
    }

    // ---------- Instanz ----------

    suspend fun probe(url: String): Probe {
        val r = call("POST", "remote/probe", JSONObject().put("url", url), 20_000)
        val s = r.getJSONObject("status")
        return Probe(r.getString("url"), InstanceStatus(s.optBoolean("openRegistration"), s.optBoolean("needsSetup")))
    }

    suspend fun useInstance(url: String) {
        call("POST", "remote/use", JSONObject().put("url", url))
        refresh()
    }

    /** angemeldete Person auf der Instanz (Anmeldename, Anzeigename) oder null */
    suspend fun remoteMe(): Pair<String, String>? = runCatching {
        val me = call("GET", "remote/me", null, 15_000).optJSONObject("me") ?: return null
        me.getString("username") to me.optString("displayName")
    }.getOrNull()

    suspend fun logout() {
        runCatching { call("POST", "remote/logout", JSONObject(), 15_000) }
        refresh()
    }

    /** Anmelden bzw. registrieren über den Instanz-Port: der Host merkt sich die Sitzung */
    suspend fun signIn(username: String, password: String, register: Boolean, displayName: String?, invite: String?) = withContext(Dispatchers.IO) {
        val c = URL(remoteUrl + if (register) "api/register" else "api/login").openConnection() as HttpURLConnection
        c.connectTimeout = 5000; c.readTimeout = 30_000
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("Origin", remoteUrl.trimEnd('/'))
        c.setRequestProperty("x-lang", L10n.lang)
        val body = JSONObject().put("username", username).put("password", password)
        if (!displayName.isNullOrBlank()) body.put("displayName", displayName)
        if (!invite.isNullOrBlank()) body.put("token", invite)
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        if (code != 200) {
            val text = c.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            throw HostError(runCatching { JSONObject(text).getString("error") }.getOrDefault(T("Anmeldung fehlgeschlagen", "Sign-in failed")))
        }
        c.inputStream.close()
        refresh()
    }

    suspend fun mergeStart(conflict: String, visibility: String, label: String): Int? {
        val r = call("POST", "merge/start", JSONObject().put("conflict", conflict).put("visibility", visibility).put("label", label), 120_000)
        return if (r.has("id") && !r.isNull("id")) r.getInt("id") else null
    }

    suspend fun mergeStatus(id: Int): MergeStatus {
        val r = call("POST", "merge/status", JSONObject().put("id", id), 30_000)
        return MergeStatus(r.getString("status"), r.optInt("total"), r.optInt("done"), r.optInt("ok"), r.optInt("exists"),
            r.optJSONArray("failed")?.length() ?: 0, r.optInt("conflictCount"))
    }

    suspend fun setLanguage(lang: String) { runCatching { call("POST", "lang", JSONObject().put("lang", lang)) } }

    // ---------- Steuer-API ----------

    private suspend fun call(method: String, path: String, body: JSONObject?, timeout: Int = 10_000): JSONObject = withContext(Dispatchers.IO) {
        val c = URL("http://127.0.0.1:$controlPort/$path").openConnection() as HttpURLConnection
        c.connectTimeout = minOf(timeout, 3000)
        c.readTimeout = timeout
        c.requestMethod = method
        c.setRequestProperty("x-bs-token", token)
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code != 200) throw HostError(runCatching { JSONObject(text).getString("error") }.getOrDefault(T("Fehler", "Error") + " $code"))
        JSONObject(text.ifEmpty { "{}" })
    }

    private fun copyAssets(ctx: Context, path: String, dst: File) {
        val list = ctx.assets.list(path) ?: emptyArray()
        if (list.isEmpty()) {
            dst.parentFile?.mkdirs()
            ctx.assets.open(path).use { input -> dst.outputStream().use { input.copyTo(it) } }
            return
        }
        dst.mkdirs()
        for (name in list) copyAssets(ctx, "$path/$name", File(dst, name))
    }

    /** Bevorzugt `count` aufeinanderfolgende Ports ab `preferred`, sonst freie vom System. */
    private fun freePorts(preferred: Int, count: Int): List<Int> {
        fun bindable(p: Int) = runCatching { ServerSocket(p, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort } }.getOrNull()
        val wanted = (0 until count).map { preferred + it }
        if (wanted.all { bindable(it) != null }) return wanted
        return wanted.map { bindable(it) ?: bindable(0) ?: it }
    }
}
