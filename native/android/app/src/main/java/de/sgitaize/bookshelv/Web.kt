package de.sgitaize.bookshelv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Ereignisse an die Seite schicken (`window.bookshelvNative.dispatch`, web/src/lib/app.svelte.ts) */
object Web {
    var view: WebView? = null
    private var loaded = false
    private val queue = mutableListOf<JSONObject>()

    fun dispatch(event: JSONObject) {
        val w = view
        if (w == null || !loaded) { queue += event; return }
        w.evaluateJavascript("window.bookshelvNative && window.bookshelvNative.dispatch($event)", null)
    }

    fun pageLoaded(loaded: Boolean) {
        this.loaded = loaded
        if (loaded) { val q = queue.toList(); queue.clear(); q.forEach(::dispatch) }
    }
}

/** `window.bookshelvAndroid.post(json)` aus der Weboberfläche */
class WebBridge(private val activity: MainActivity, private val origin: () -> String) {
    @JavascriptInterface
    fun post(json: String) {
        activity.runOnUiThread { activity.onWebMessage(json) }
    }
}

/**
 * Die Bibliothek: WebView auf dem eingebetteten App-Host (lokal oder Instanz-Port) – wie LibraryWebView.swift.
 * Nur die eigene Seite läuft in der App, alles andere öffnet der Browser. Downloads und navigator.share gehen an
 * den Teilen-Dialog von Android.
 */
@SuppressLint("SetJavaScriptEnabled")
class LibraryWeb(private val activity: MainActivity) {
    val web = WebView(activity)
    private var baseUrl = ""
    private var script: ScriptHandler? = null
    private var retries = 0
    private val scope: CoroutineScope = MainScope()
    var fileCallback: ValueCallback<Array<Uri>>? = null

    init {
        web.layoutParams = ViewGroup.LayoutParams(-1, -1)
        web.setBackgroundColor(Color.parseColor("#121516"))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // localStorage, Lesecache, vorgemerkte Änderungen
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            setSupportZoom(false)               // wie eine App: nicht zoombar
            builtInZoomControls = false
            displayZoomControls = false
            userAgentString = "$userAgentString BookshelvApp/1"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.addJavascriptInterface(WebBridge(activity) { baseUrl }, "bookshelvAndroid")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, _, disposition, mime, _ -> download(url, disposition, mime) }
        Web.view = web
    }

    /** App-Infos setzen und laden (bei Moduswechsel/Neuladen) */
    fun load(base: String, appInfo: JSONObject, path: String?) {
        baseUrl = base
        Web.pageLoaded(false)
        val source = "window.bookshelvApp = $appInfo;\n$SHIMS"
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            script?.remove()
            script = WebViewCompat.addDocumentStartJavaScript(web, source, setOf("http://127.0.0.1:${Uri.parse(base).port}"))
        } else {
            pendingSource = source
        }
        // Lokal-Modus: Anmeldung per Cookie bs_app (gilt für 127.0.0.1, die Instanz-Weiterleitung ignoriert es)
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setCookie("http://127.0.0.1/", "bs_app=${NodeHost.token}; Path=/; Max-Age=31536000")
        cm.flush()
        web.loadUrl(if (path != null) Uri.parse(base).buildUpon().encodedPath(path.substringBefore('?')).encodedQuery(path.substringAfter('?', "").ifEmpty { null }).build().toString() else base)
    }

    private var pendingSource: String? = null

    fun destroy() {
        scope.cancel()
        if (Web.view === web) Web.view = null
        web.destroy()
    }

    private fun isOwn(uri: Uri?) = uri != null && uri.host == "127.0.0.1" && uri.port == Uri.parse(baseUrl).port

    private fun openExternally(uri: Uri) {
        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val u = req.url
            if (isOwn(u) || u.scheme in setOf("about", "blob", "data", "javascript")) return false
            openExternally(u)
            return true
        }
        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            pendingSource?.let { view.evaluateJavascript(it, null) }
        }
        override fun onPageFinished(view: WebView, url: String) {
            retries = 0
            if (isOwn(Uri.parse(url))) { view.evaluateJavascript(THEME_WATCH, null); Web.pageLoaded(true) }
        }
        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (!req.isForMainFrame || retries++ > 30) return
            // Host öffnet seinen Port nach dem Aufwachen gerade neu → kurz warten, erneut laden
            scope.launch { NodeHost.waitReady(5000); view.loadUrl(req.url.toString()) }
        }
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            activity.recreateWeb()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        // target=_blank / window.open → eigene Seite hier, sonst Browser
        override fun onCreateWindow(view: WebView, dialog: Boolean, user: Boolean, msg: android.os.Message): Boolean {
            val href = view.hitTestResult.extra ?: return false
            val uri = Uri.parse(href)
            if (isOwn(uri)) web.loadUrl(href) else openExternally(uri)
            return false
        }
        // <input type=file> (Cover, Profilbild, Import-Datei)
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }
            val mimes = types.map { t ->
                when {
                    t.startsWith(".") -> when (t) { ".csv" -> "text/csv"; ".tsv" -> "text/tab-separated-values"; ".txt" -> "text/plain"; else -> "*/*" }
                    else -> t
                }
            }.distinct()
            activity.pickFile(if (mimes.isEmpty()) arrayOf("*/*") else if (mimes.any { it.startsWith("text/") }) (mimes + "*/*").toTypedArray() else mimes.toTypedArray())
            return true
        }
        // Kamera für den Web-Scanner (nur falls der native fehlt): nur für die eigene Seite
        override fun onPermissionRequest(request: PermissionRequest) {
            if (isOwn(request.origin) && request.resources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE } && activity.hasCamera()) request.grant(request.resources)
            else request.deny()
        }
    }

    fun deliverFile(uri: Uri?) {
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileCallback = null
    }

    // ---------- Dateien teilen ----------

    /** Download der Seite: blob: liest die Seite selbst aus (SHIMS), http(s) vom eigenen Host holt die App mit Cookie */
    private fun download(url: String, disposition: String?, mime: String?) {
        val uri = Uri.parse(url)
        if (!isOwn(uri)) { if (uri.scheme == "http" || uri.scheme == "https") openExternally(uri); return }
        val name = URLUtil.guessFileName(url, disposition, mime)
        scope.launch {
            runCatching {
                val file = withContext(Dispatchers.IO) {
                    val c = URL(url).openConnection() as HttpURLConnection
                    CookieManager.getInstance().getCookie(url)?.let { c.setRequestProperty("Cookie", it) }
                    val f = shareFile(name)
                    c.inputStream.use { input -> f.outputStream().use { input.copyTo(it) } }
                    f
                }
                share(listOf(file), mime ?: "application/octet-stream", null, null)
            }
        }
    }

    /** Nachricht „share“/„download“ der Seite: Dateien als data:-URL */
    fun shareFromPage(m: JSONObject) {
        scope.launch {
            val files = withContext(Dispatchers.IO) {
                val arr = m.optJSONArray("files") ?: JSONArray()
                (0 until arr.length()).mapNotNull { i ->
                    val f = arr.getJSONObject(i)
                    val data = f.optString("data").substringAfter("base64,", "")
                    if (data.isEmpty()) return@mapNotNull null
                    shareFile(f.optString("name").ifEmpty { "bookshelv" }).apply { writeBytes(Base64.decode(data, Base64.DEFAULT)) }
                }
            }
            val type = m.optJSONArray("files")?.optJSONObject(0)?.optString("type")?.ifEmpty { null } ?: "text/plain"
            share(files, type, m.optString("title").ifEmpty { null }, listOf(m.optString("text"), m.optString("url")).filter { it.isNotEmpty() }.joinToString("\n").ifEmpty { null })
        }
    }

    private fun shareFile(name: String): File {
        val dir = File(activity.cacheDir, "share").apply { deleteRecursively(); mkdirs() }
        return File(dir, name.replace(Regex("[/\\\\]"), "_"))
    }

    private fun share(files: List<File>, type: String, title: String?, text: String?) {
        val uris = files.map { FileProvider.getUriForFile(activity, "${activity.packageName}.files", it) }
        val send = if (uris.size > 1) Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
        else Intent(Intent.ACTION_SEND).apply { uris.firstOrNull()?.let { putExtra(Intent.EXTRA_STREAM, it) } }
        send.type = if (uris.isEmpty()) "text/plain" else type
        if (text != null) send.putExtra(Intent.EXTRA_TEXT, text)
        if (title != null) send.putExtra(Intent.EXTRA_SUBJECT, title)
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { activity.startActivity(Intent.createChooser(send, title)) }
    }

    companion object {
        /** navigator.share (fehlt in der WebView) und Blob-Downloads an die App weiterreichen */
        private const val SHIMS = """
(function(){
  var post = function(m){ try { window.bookshelvAndroid.post(JSON.stringify(m)); } catch (e) {} };
  var asData = function(blob){ return new Promise(function(ok, no){ var r = new FileReader(); r.onload = function(){ ok(r.result); }; r.onerror = no; r.readAsDataURL(blob); }); };
  navigator.canShare = function(){ return true; };
  navigator.share = function(d){
    d = d || {};
    return Promise.all((d.files || []).map(function(f){ return asData(f).then(function(u){ return { name: f.name, type: f.type, data: u }; }); }))
      .then(function(files){ post({ a: 'share', title: d.title || '', text: d.text || '', url: d.url || '', files: files }); });
  };
  // Blobs merken (fetch(blob:) verbietet die CSP der Seite)
  var blobs = {}, mk = URL.createObjectURL, rm = URL.revokeObjectURL;
  URL.createObjectURL = function(b){ var u = mk.call(URL, b); if (b instanceof Blob) blobs[u] = b; return u; };
  URL.revokeObjectURL = function(u){ setTimeout(function(){ delete blobs[u]; rm.call(URL, u); }, 60000); };
  var click = HTMLAnchorElement.prototype.click;
  var save = function(a){
    var b = blobs[a.href]; if (!b) return;
    asData(b).then(function(u){ post({ a: 'share', title: '', text: '', url: '', files: [{ name: a.download || 'bookshelv', type: b.type, data: u }] }); });
  };
  HTMLAnchorElement.prototype.click = function(){
    if (this.hasAttribute('download') && /^blob:/.test(this.href)) return save(this);
    return click.call(this);
  };
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && /^blob:/.test(a.href)) { e.preventDefault(); save(a); }
  }, true);
})();
"""
        /** Farbe der Seite (meta theme-color) an die App melden – für Statusleiste und Ränder */
        private const val THEME_WATCH = """
(function(){
  if (window.__bsTheme) return; window.__bsTheme = 1;
  var send = function(){ var m = document.querySelector('meta[name=theme-color]'); window.bookshelvAndroid.post(JSON.stringify({ a: 'theme', c: m ? m.content : null })); };
  new MutationObserver(send).observe(document.head, { subtree: true, attributes: true, childList: true });
  send();
})();
"""
    }
}
