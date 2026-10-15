package de.sgitaize.bookshelv

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object Palette {
    val background = Color(0xFF121516)
    val surface = Color(0xFF1B2022)
    val surfaceHigh = Color(0xFF242A2C)
    val accent = Color(0xFF5FB0B3)
    val text = Color(0xFFF3ECE0)
    val muted = Color(0xFFA8A296)
    val red = Color(0xFFE06A55)
    val spines = listOf(Color(0xFFE8A54B), Color(0xFFC8553D), Color(0xFF5B8C85), Color(0xFFF3ECE0), Color(0xFF5FB0B3), Color(0xFFE8A54B))
}

/** Native Teile (Start, Konto, Sicherung) im Look der Weboberfläche: dunkel, Petrol als Akzent */
@Composable
fun BookshelvTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent, onPrimary = Color.Black,
            secondary = Palette.accent, onSecondary = Color.Black,
            background = Palette.background, onBackground = Palette.text,
            surface = Palette.background, onSurface = Palette.text,
            surfaceVariant = Palette.surface, onSurfaceVariant = Palette.muted,
            surfaceContainer = Palette.surface, surfaceContainerHigh = Palette.surfaceHigh, surfaceContainerHighest = Palette.surfaceHigh,
            surfaceContainerLow = Palette.surface, surfaceContainerLowest = Palette.background,
            error = Palette.red, outline = Color(0xFF3A4245), outlineVariant = Color(0xFF2C3335),
        ),
        content = content,
    )
}
