import AVFoundation
import SwiftUI
import VisionKit

/// Nativer ISBN-Scanner (VisionKit, EAN-13 mit 978/979).
/// Einzeln: schließt nach dem ersten Treffer. Mehrfach (Massen-Scan): bleibt offen, zeigt je Buch die Rückmeldung der Seite.
@MainActor
final class ScanSession: ObservableObject {
    static let shared = ScanSession()
    struct Request: Identifiable { let id: Int; let multi: Bool }
    @Published var request: Request?
    @Published var feedback: (text: String, kind: String)?
    @Published var count = 0

    static var isAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

    func open(id: Int, multi: Bool) {
        feedback = nil
        count = 0
        request = Request(id: id, multi: multi)
    }

    func found(_ isbn: String) {
        guard let r = request else { return }
        WebBridge.shared.dispatch(["type": "scan", "id": r.id, "isbn": isbn])
        count += 1
        if !r.multi { close() }
    }

    func close() {
        guard let r = request else { return }
        request = nil
        WebBridge.shared.dispatch(["type": "scanClosed", "id": r.id])
    }

    func show(_ text: String, kind: String) {
        feedback = (text, kind)
        switch kind {
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "warn": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        default: UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }
}

struct ScannerScreen: View {
    let multi: Bool
    @ObservedObject var session = ScanSession.shared
    @State private var torch = false
    @State private var denied = AVCaptureDevice.authorizationStatus(for: .video) == .denied

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if denied {
                VStack(spacing: 14) {
                    Image(systemName: "camera.fill").font(.system(size: 40))
                    Text(T("Kein Zugriff auf die Kamera", "No camera access")).font(.headline)
                    Text(T("Erlaube den Zugriff in den Einstellungen, um ISBNs zu scannen.", "Allow access in Settings to scan ISBNs."))
                        .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    Button(T("Einstellungen öffnen", "Open Settings")) {
                        if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                    }.buttonStyle(.borderedProminent)
                }.padding(32).foregroundStyle(.white)
            } else {
                DataScanner(torch: torch, onIsbn: { session.found($0) })
                    .ignoresSafeArea()
                frame
            }
            VStack {
                HStack {
                    Button { session.close() } label: {
                        Text(multi ? T("Fertig", "Done") : T("Abbrechen", "Cancel")).bold()
                            .padding(.horizontal, 16).padding(.vertical, 9)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    Spacer()
                    if multi && session.count > 0 {
                        Text(T("\(session.count) gescannt", "\(session.count) scanned"))
                            .font(.subheadline.bold()).padding(.horizontal, 12).padding(.vertical, 8)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    Button { toggleTorch() } label: {
                        Image(systemName: torch ? "flashlight.on.fill" : "flashlight.off.fill")
                            .frame(width: 40, height: 40).background(.ultraThinMaterial, in: Circle())
                    }.accessibilityLabel(T("Taschenlampe", "Flashlight"))
                }
                .padding(.horizontal, 16).padding(.top, 8)
                Spacer()
                VStack(spacing: 10) {
                    if let f = session.feedback, !f.text.isEmpty {
                        Label(f.text, systemImage: f.kind == "error" ? "xmark.circle.fill" : f.kind == "warn" ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                            .font(.callout.weight(.semibold))
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .frame(maxWidth: 520)
                            .background(f.kind == "error" ? Color.red.opacity(0.85) : f.kind == "warn" ? Color.orange.opacity(0.9) : Color.green.opacity(0.85), in: RoundedRectangle(cornerRadius: 14))
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .id(f.text)
                    }
                    Text(multi ? T("Ein Buch nach dem anderen – jedes kommt sofort ins Regal.", "One book after another – each goes straight onto your shelf.")
                               : T("Barcode auf der Rückseite in den Rahmen halten", "Hold the barcode on the back inside the frame"))
                        .font(.footnote).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center)
                }
                .padding(.horizontal, 20).padding(.bottom, 24)
                .animation(.spring(duration: 0.3), value: session.feedback?.text)
            }
            .foregroundStyle(.white)
        }
        .task {
            if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
                denied = !(await AVCaptureDevice.requestAccess(for: .video))
            }
        }
        .onDisappear { if torch { DataScanner.setTorch(false) } }
    }

    private var frame: some View {
        GeometryReader { g in
            let w = min(g.size.width * 0.8, 420), h = w * 0.42
            RoundedRectangle(cornerRadius: 14)
                .stroke(.white.opacity(0.9), lineWidth: 2)
                .frame(width: w, height: h)
                .position(x: g.size.width / 2, y: g.size.height * 0.45)
        }
        .allowsHitTesting(false)
    }

    private func toggleTorch() { torch.toggle() }
}

/// VisionKit-Scanner als SwiftUI-View
private struct DataScanner: UIViewControllerRepresentable {
    var torch: Bool
    var onIsbn: (String) -> Void

    /// Die Lampe muss an genau dem Gerät geschaltet werden, das VisionKit benutzt – auf Pro-Modellen
    /// ist das die virtuelle Mehrfachkamera. Schaltet man stattdessen das einzelne Weitwinkel-Modul,
    /// bricht die laufende Kamera-Session ab (Bild bleibt schwarz/eingefroren).
    static func setTorch(_ on: Bool) {
        let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
        let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices
        guard let dev = types.lazy.compactMap({ t in found.first { $0.deviceType == t } }).first,
              dev.hasTorch, dev.isTorchAvailable, dev.isTorchModeSupported(on ? .on : .off) else { return }
        do {
            try dev.lockForConfiguration()
            defer { dev.unlockForConfiguration() }
            if on { try dev.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel) } else { dev.torchMode = .off }
        } catch {}
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.ean13])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: false,
            isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        context.coordinator.onIsbn = onIsbn
        if !vc.isScanning { try? vc.startScanning() }
        if context.coordinator.torch != torch {
            context.coordinator.torch = torch
            Self.setTorch(torch)
            // falls die Session beim Umschalten doch kurz unterbrochen wurde: wieder anwerfen
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { if !vc.isScanning { try? vc.startScanning() } }
        }
    }

    static func dismantleUIViewController(_ vc: DataScannerViewController, coordinator: Coordinator) { vc.stopScanning() }

    func makeCoordinator() -> Coordinator { Coordinator(onIsbn: onIsbn) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onIsbn: (String) -> Void
        var torch = false
        private var last = ""
        private var lastAt = Date.distantPast
        init(onIsbn: @escaping (String) -> Void) { self.onIsbn = onIsbn }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) { handle(items) }
        func dataScanner(_ scanner: DataScannerViewController, didUpdate items: [RecognizedItem], allItems: [RecognizedItem]) { handle(items) }

        private func handle(_ items: [RecognizedItem]) {
            for item in items {
                guard case .barcode(let b) = item, let code = b.payloadStringValue, code.range(of: #"^97[89]\d{10}$"#, options: .regularExpression) != nil else { continue }
                // gleiches Buch nicht mehrfach hintereinander (es bleibt ja im Bild)
                if code == last && Date().timeIntervalSince(lastAt) < 4 { continue }
                last = code; lastAt = Date()
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                AudioServicesPlaySystemSound(1057)
                onIsbn(code)
            }
        }
    }
}
