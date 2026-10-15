package de.sgitaize.bookshelv

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Haptik wie unter iOS (web: haptic('light' | 'medium' | 'success' | 'warning' | 'error' | 'select')) */
object Haptics {
    private var vibrator: Vibrator? = null

    fun init(ctx: Context) {
        vibrator = if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
    }

    fun play(kind: String) {
        val v = vibrator ?: return
        val effect = if (Build.VERSION.SDK_INT >= 29) when (kind) {
            "success" -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK)
            "warning", "error" -> VibrationEffect.createWaveform(longArrayOf(0, 30, 60, 30), -1)
            "medium" -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)
            "select" -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
            else -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
        } else VibrationEffect.createOneShot(if (kind == "light" || kind == "select") 12 else 35, VibrationEffect.DEFAULT_AMPLITUDE)
        runCatching { v.vibrate(effect) }
    }
}
