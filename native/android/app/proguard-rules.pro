# Brücke der Weboberfläche (window.bookshelvAndroid.post)
-keepclassmembers class de.sgitaize.bookshelv.WebBridge { @android.webkit.JavascriptInterface <methods>; }
# JNI: NodeHost.startNode
-keepclasseswithmembernames class * { native <methods>; }
