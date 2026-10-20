package de.sgitaize.bookshelv

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * Google Play: Updates kommen über den Store, Trinkgeld per Play Billing – Verbrauchsartikel mit denselben IDs wie
 * bei iOS (TipJar.swift). Die Produkte legt der Account-Inhaber in der Play Console an (In-App-Produkte, nicht Abos).
 * Ein Trinkgeld schaltet nichts frei; jeder Kauf wird sofort verbraucht, damit man ihn wiederholen kann.
 */
object Store {
    const val SHARE_URL = "https://play.google.com/store/apps/details?id=de.sgitaize.bookshelv"
    private val PRODUCT_IDS = listOf("de.sgitaize.bookshelv.tip.small", "de.sgitaize.bookshelv.tip.medium", "de.sgitaize.bookshelv.tip.large")

    const val hasTips = true

    private var client: BillingClient? = null
    private var products by mutableStateOf<List<ProductDetails>>(emptyList())
    private var loading by mutableStateOf(false)
    private var thanks by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)

    private fun connect(ctx: Context) {
        client?.let { if (it.isReady) { load(); return } }
        loading = true
        error = null
        val c = BillingClient.newBuilder(ctx.applicationContext)
            .setListener { result, purchases -> onPurchases(result, purchases) }
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
        client = c
        c.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode != BillingResponseCode.OK) { fail(); return }
                load()
                // Käufe, die noch nicht verbraucht sind (App während des Kaufs beendet, „ausstehend“ bezahlt) nachholen
                c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build()) { _, list -> list.forEach(::consume) }
            }
            override fun onBillingServiceDisconnected() { client = null }
        })
    }

    private fun load() {
        val c = client ?: return
        loading = true
        val params = QueryProductDetailsParams.newBuilder().setProductList(PRODUCT_IDS.map {
            QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(ProductType.INAPP).build()
        }).build()
        c.queryProductDetailsAsync(params) { result, res ->
            val list = res.productDetailsList   // Billing 8: Ergebnisobjekt statt Liste
            loading = false
            if (result.responseCode == BillingResponseCode.OK) products = list.sortedBy { it.oneTimePurchaseOfferDetails?.priceAmountMicros ?: 0 }
            else fail()
        }
    }

    private fun fail() {
        loading = false
        error = T("Die Trinkgeld-Optionen konnten gerade nicht von Google Play geladen werden.", "The tip options could not be loaded from Google Play right now.")
    }

    private fun buy(activity: Activity, p: ProductDetails) {
        val c = client ?: return
        error = null
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(p).build()))
            .build()
        val r = c.launchBillingFlow(activity, flow)
        if (r.responseCode != BillingResponseCode.OK && r.responseCode != BillingResponseCode.USER_CANCELED) error = r.debugMessage.ifEmpty { null }
    }

    private fun onPurchases(result: BillingResult, purchases: List<Purchase>?) {
        if (result.responseCode == BillingResponseCode.OK) purchases?.forEach(::consume)
        else if (result.responseCode != BillingResponseCode.USER_CANCELED) error = result.debugMessage.ifEmpty { null }
    }

    private fun consume(p: Purchase) {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED) return
        client?.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { r, _ ->
            if (r.responseCode == BillingResponseCode.OK) thanks = true
        }
    }

    private tailrec fun Context.activity(): Activity? = when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.activity()
        else -> null
    }

    private fun emoji(id: String) = when { id.endsWith("small") -> "☕"; id.endsWith("medium") -> "📖"; else -> "📚" }

    @Composable
    fun TipRows() {
        val ctx = LocalContext.current
        LaunchedEffect(Unit) { if (products.isEmpty()) connect(ctx) }
        when {
            loading && products.isEmpty() -> ListRow(null, T("Lade Trinkgeld-Optionen …", "Loading tip options …"), trailing = { CircularProgressIndicator(Modifier.padding(2.dp)) })
            products.isEmpty() -> ListRow(Icons.Filled.Refresh, T("Trinkgeld: erneut versuchen", "Tips: try again"), sub = error) { connect(ctx) }
            else -> products.forEach { p ->
                ListRow(null, "${emoji(p.productId)}  ${p.name}", sub = p.description.ifEmpty { null },
                    trailing = { Text(p.oneTimePurchaseOfferDetails?.formattedPrice ?: "", fontWeight = FontWeight.Bold) }) {
                    ctx.activity()?.let { buy(it, p) }
                }
            }
        }
        if (products.isNotEmpty()) error?.let { ListRow(null, it, color = Palette.red) }
        if (thanks) ListRow(Icons.Filled.Favorite, T("Danke! Das bedeutet mir viel.", "Thank you! That means a lot."), color = Palette.red)
    }
}
