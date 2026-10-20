import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Signatur für die Download-APK: signing.properties (nicht im Repo) mit storeFile, storePassword, keyAlias, keyPassword
val signing = Properties().apply {
    val f = rootProject.file("signing.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "de.sgitaize.bookshelv"
    compileSdk = 36
    ndkVersion = "27.2.12479018"

    defaultConfig {
        applicationId = "de.sgitaize.bookshelv"
        minSdk = 26
        targetSdk = 36
        versionCode = 5
        versionName = "1.1.0"
        // 16-KB-Speicherseiten (Play-Pflicht für 64-Bit): eigene libbsnode so linken; libnode selbst gebaut, siehe scripts/fetch-deps.sh
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_shared", "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON") } }
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    // Zwei Vertriebswege: „github“ = Download-APK aus den GitHub-Releases (Update-Hinweis beim Start),
    // „play“ = Google Play (App Bundle, Updates über den Store, Trinkgeld per Play Billing)
    flavorDimensions += "store"
    productFlavors {
        create("github") {
            dimension = "store"
            buildConfigField("boolean", "UPDATE_CHECK", "true")
        }
        create("play") {
            dimension = "store"
            buildConfigField("boolean", "UPDATE_CHECK", "false")
            // Play liefert aus dem App Bundle je Gerät nur die passende Architektur → zusätzlich 32-Bit-ARM und x86_64
            ndk { abiFilters += listOf("armeabi-v7a", "x86_64") }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // github: Release-Schlüssel; play: derselbe Schlüssel als Upload-Schlüssel (Google signiert neu, Play App Signing)
            signingConfigs.findByName("release")?.let { signingConfig = it }
            // Download-APK: nur 64-Bit-ARM (alle Geräte der letzten Jahre); libnode ist ~40 MB je Architektur
            ndk { abiFilters += listOf("arm64-v8a") }
        }
        debug {
            ndk { abiFilters += listOf("arm64-v8a", "x86_64") }   // x86_64 für den Emulator
        }
    }

    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
    sourceSets["main"].jniLibs.srcDirs("libnode/bin")
    packaging { jniLibs { useLegacyPackaging = true } }   // libnode.so entpackt (schnellerer Start)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true; compose = true }
}

// Oberfläche + App-Host (npm run build:app → native/build/server) ins APK (assets/server) – wie Scripts/bundle-server.sh bei iOS.
// Mit -PskipWebBuild wird nur kopiert (z. B. wenn der Build schon gelaufen ist).
val repoRoot = rootProject.file("../..")
val buildWeb by tasks.registering(Exec::class) {
    workingDir = repoRoot
    commandLine("npm", "run", "build:app")
    onlyIf { !project.hasProperty("skipWebBuild") }
}
val bundleServer by tasks.registering(Sync::class) {
    dependsOn(buildWeb)
    from(File(repoRoot, "native/build/server")) { include("host.js", "public/**"); exclude("public/sw.js") }
    into("src/main/assets/server")
}
tasks.named("preBuild") { dependsOn(bundleServer) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // ISBN-Scanner: CameraX + ML Kit mit mitgeliefertem Modell (läuft ohne Google Play)
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    // Trinkgeld im Play Store (Verbrauchsartikel wie bei iOS); die Download-APK kommt ohne Google-Bibliothek aus
    "playImplementation"("com.android.billingclient:billing-ktx:8.0.0")
}
