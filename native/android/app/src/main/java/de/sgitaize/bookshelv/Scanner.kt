package de.sgitaize.bookshelv

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import android.provider.Settings
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.FlashlightOff
import androidx.compose.material.icons.filled.FlashlightOn
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Nativer ISBN-Scanner (CameraX + ML Kit, EAN-13 mit 978/979) – wie ScannerView.swift.
 * Einzeln: schließt nach dem ersten Treffer. Mehrfach (Massen-Scan): bleibt offen, zeigt je Buch die Rückmeldung der Seite.
 */
object ScanSession {
    data class Request(val id: Int, val multi: Boolean)
    data class Feedback(val text: String, val kind: String, val seq: Int)

    var request by mutableStateOf<Request?>(null); private set
    var feedback by mutableStateOf<Feedback?>(null); private set
    var count by mutableIntStateOf(0); private set
    private var seq = 0

    fun isAvailable(ctx: Context) = ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    fun open(id: Int, multi: Boolean) {
        feedback = null
        count = 0
        request = Request(id, multi)
    }

    fun found(isbn: String) {
        val r = request ?: return
        Web.dispatch(JSONObject().put("type", "scan").put("id", r.id).put("isbn", isbn))
        count++
        if (!r.multi) close()
    }

    fun close() {
        val r = request ?: return
        request = null
        Web.dispatch(JSONObject().put("type", "scanClosed").put("id", r.id))
    }

    fun show(text: String, kind: String) {
        feedback = Feedback(text, kind, ++seq)
        Haptics.play(if (kind == "error") "error" else if (kind == "warn") "warning" else "success")
    }

    /** EAN-13 eines Buchs (978/979) mit gültiger Prüfziffer */
    fun isIsbn(code: String): Boolean {
        if (!Regex("^97[89]\\d{10}$").matches(code)) return false
        val sum = code.take(12).mapIndexed { i, c -> (c - '0') * if (i % 2 == 0) 1 else 3 }.sum()
        return (10 - sum % 10) % 10 == code[12] - '0'
    }
}

@Composable
fun ScannerScreen(multi: Boolean) {
    val ctx = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }
    var torch by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<Camera?>(null) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) {
            CameraPreview(onCamera = { camera = it }) { ScanSession.found(it) }
            ScanFrame()
        } else if (asked) {
            Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Icon(Icons.Filled.PhotoCamera, null, tint = Color.White, modifier = Modifier.size(40.dp))
                Text(T("Kein Zugriff auf die Kamera", "No camera access"), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
                Text(T("Erlaube den Zugriff in den Einstellungen, um ISBNs zu scannen.", "Allow access in Settings to scan ISBNs."),
                    color = Color.White.copy(alpha = 0.7f), textAlign = TextAlign.Center)
                Button(onClick = {
                    ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)))
                }) { Text(T("Einstellungen öffnen", "Open Settings")) }
            }
        }
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { ScanSession.close() }, modifier = Modifier.background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(50))) {
                    Text(if (multi) T("Fertig", "Done") else T("Abbrechen", "Cancel"), color = Color.White, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.weight(1f))
                if (multi && ScanSession.count > 0) {
                    Text(T("${ScanSession.count} gescannt", "${ScanSession.count} scanned"), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp,
                        modifier = Modifier.background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 8.dp))
                    Spacer(Modifier.size(8.dp))
                }
                if (camera?.cameraInfo?.hasFlashUnit() == true) {
                    IconButton(onClick = { torch = !torch; camera?.cameraControl?.enableTorch(torch) },
                        modifier = Modifier.background(Color.Black.copy(alpha = 0.45f), CircleShape)) {
                        Icon(if (torch) Icons.Filled.FlashlightOn else Icons.Filled.FlashlightOff, T("Taschenlampe", "Flashlight"), tint = Color.White)
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AnimatedContent(ScanSession.feedback, label = "feedback",
                    transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith fadeOut() }) { f ->
                    if (f != null && f.text.isNotEmpty()) {
                        val bg = when (f.kind) { "error" -> Color(0xD9C0392B); "warn" -> Color(0xE6D9822B); else -> Color(0xD92E8B57) }
                        Row(Modifier.widthIn(max = 520.dp).fillMaxWidth().background(bg, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(when (f.kind) { "error" -> Icons.Filled.Error; "warn" -> Icons.Filled.Warning; else -> Icons.Filled.CheckCircle }, null, tint = Color.White)
                            Text(f.text, color = Color.White, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                Text(if (multi) T("Ein Buch nach dem anderen – jedes kommt sofort ins Regal.", "One book after another – each goes straight onto your shelf.")
                     else T("Barcode auf der Rückseite in den Rahmen halten", "Hold the barcode on the back inside the frame"),
                    color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, textAlign = TextAlign.Center)
            }
        }
    }
    DisposableEffect(Unit) { onDispose { camera?.cameraControl?.enableTorch(false) } }
}

@Composable
private fun ScanFrame() {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = minOf(maxWidth * 0.8f, 420.dp)
        val h = w * 0.42f
        Box(Modifier.offset(x = (maxWidth - w) / 2, y = maxHeight * 0.45f - h / 2).size(w, h)
            .border(2.dp, Color.White.copy(alpha = 0.9f), RoundedCornerShape(14.dp)))
    }
}

@Composable
private fun CameraPreview(onCamera: (Camera) -> Unit, onIsbn: (String) -> Unit) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember {
        BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_EAN_13).build())
    }
    val beep = remember { runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60) }.getOrNull() }

    DisposableEffect(owner) {
        val future = ProcessCameraProvider.getInstance(ctx)
        var last = ""
        var lastAt = 0L
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                    ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(executor) { proxy ->
                val media = proxy.image
                if (media == null) { proxy.close(); return@setAnalyzer }
                scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener { codes ->
                        for (c in codes) {
                            val code = c.rawValue ?: continue
                            if (!ScanSession.isIsbn(code)) continue
                            // gleiches Buch nicht mehrfach hintereinander (es bleibt ja im Bild)
                            val now = System.currentTimeMillis()
                            if (code == last && now - lastAt < 4000) continue
                            last = code; lastAt = now
                            Haptics.play("medium")
                            beep?.startTone(ToneGenerator.TONE_PROP_BEEP, 80)
                            onIsbn(code)
                        }
                    }
                    .addOnCompleteListener { proxy.close() }
            }
            runCatching {
                provider.unbindAll()
                onCamera(provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis))
            }
        }, ContextCompat.getMainExecutor(ctx))
        onDispose {
            runCatching { future.get().unbindAll() }
            scanner.close()
            executor.shutdown()
            beep?.release()
        }
    }
    AndroidView({ previewView }, Modifier.fillMaxSize())
}
