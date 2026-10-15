import Foundation
import UIKit

/// Sicherung der lokalen Bibliothek in die eigene iCloud (iCloud Drive → „bookshelv“ → Sicherung).
/// Inhalt: konsistente Kopie der Datenbank (VACUUM INTO im App-Host), Cover, Profilbild, info.json.
/// Cover-Dateinamen enthalten einen Zufallsanteil und ändern sich nie → es werden nur neue kopiert.
@MainActor
final class BackupManager: ObservableObject {
    static let shared = BackupManager()

    struct Info: Codable, Equatable {
        var date: Date
        var device: String
        var books: Int
        var read: Int
        var size: Int
        var appVersion: String
    }

    @Published private(set) var busy = false
    @Published private(set) var remote: Info?
    @Published private(set) var iCloudAvailable = FileManager.default.ubiquityIdentityToken != nil
    @Published var lastError: String?

    private let fm = FileManager.default
    private static let folder = "Sicherung"

    /// iCloud-Ordner (ermitteln dauert beim ersten Mal – nie auf dem Main-Thread)
    private func container() async -> URL? {
        await Task.detached { FileManager.default.url(forUbiquityContainerIdentifier: nil) }.value?
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent(Self.folder, isDirectory: true)
    }

    // MARK: Sichern

    /// Automatisch: beim Verlassen der App, höchstens alle 15 Minuten
    func backupIfDue() {
        let model = AppModel.shared
        guard model.mode == .local, model.autoBackup, iCloudAvailable, !busy else { return }
        if let last = model.lastBackup, Date().timeIntervalSince(last) < 15 * 60 { return }
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "backup") { UIApplication.shared.endBackgroundTask(task) }
        Task {
            try? await backupNow()
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    func backupNow() async throws {
        guard !busy else { return }
        busy = true; lastError = nil
        defer { busy = false }
        do {
            guard let dir = await container() else {
                throw NodeHost.HostError(T("iCloud ist nicht verfügbar. Melde dich in den Einstellungen bei iCloud an und erlaube iCloud Drive.", "iCloud is not available. Sign in to iCloud in Settings and enable iCloud Drive."))
            }
            let tmp = fm.temporaryDirectory.appendingPathComponent("snap-\(UUID().uuidString)", isDirectory: true)
            defer { try? fm.removeItem(at: tmp) }
            let snap = try await NodeHost.shared.snapshot(to: tmp)
            let info = Info(date: Date(), device: UIDevice.current.name, books: snap.summary?.books ?? 0, read: snap.summary?.read ?? 0,
                            size: snap.size, appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
            try await Task.detached {
                let fm = FileManager.default
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                try Self.coordinatedReplace(dir.appendingPathComponent("bookshelv.db"), with: tmp.appendingPathComponent("bookshelv.db"))
                for sub in ["covers", "avatars"] { try Self.mirror(NodeHost.dataDir.appendingPathComponent(sub), to: dir.appendingPathComponent(sub)) }
                let enc = JSONEncoder(); enc.dateEncodingStrategy = .iso8601; enc.outputFormatting = .prettyPrinted
                let infoFile = tmp.appendingPathComponent("info.json")
                try enc.encode(info).write(to: infoFile)
                try Self.coordinatedReplace(dir.appendingPathComponent("info.json"), with: infoFile)
            }.value
            AppModel.shared.lastBackup = info.date
            remote = info
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    // MARK: Finden + Wiederherstellen

    /// Sicherung in der iCloud suchen (info.json zuerst herunterladen lassen)
    @discardableResult
    func lookup() async -> Info? {
        iCloudAvailable = fm.ubiquityIdentityToken != nil
        guard iCloudAvailable, let dir = await container() else { remote = nil; return nil }
        let file = dir.appendingPathComponent("info.json")
        let info: Info? = await Task.detached {
            guard (try? Self.download(file, timeout: 15)) != nil, let data = try? Data(contentsOf: file) else { return nil }
            let dec = JSONDecoder(); dec.dateDecodingStrategy = .iso8601
            return try? dec.decode(Info.self, from: data)
        }.value
        remote = info
        return info
    }

    /// Sicherung aus der iCloud laden und als lokale Bibliothek übernehmen (ersetzt die aktuelle!)
    func restoreFromICloud() async throws {
        guard !busy else { return }
        busy = true; lastError = nil
        defer { busy = false }
        do {
            guard let dir = await container() else { throw NodeHost.HostError(T("iCloud ist nicht verfügbar.", "iCloud is not available.")) }
            let tmp = fm.temporaryDirectory.appendingPathComponent("restore-\(UUID().uuidString)", isDirectory: true)
            defer { try? fm.removeItem(at: tmp) }
            try await Task.detached {
                let fm = FileManager.default
                try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
                try Self.download(dir.appendingPathComponent("bookshelv.db"), timeout: 300)
                try fm.copyItem(at: dir.appendingPathComponent("bookshelv.db"), to: tmp.appendingPathComponent("bookshelv.db"))
                for sub in ["covers", "avatars"] {
                    let from = dir.appendingPathComponent(sub)
                    guard let files = try? fm.contentsOfDirectory(at: from, includingPropertiesForKeys: nil) else { continue }
                    let to = tmp.appendingPathComponent(sub)
                    try fm.createDirectory(at: to, withIntermediateDirectories: true)
                    for f in files {
                        let name = f.lastPathComponent.hasPrefix(".") && f.pathExtension == "icloud"
                            ? String(f.deletingPathExtension().lastPathComponent.dropFirst()) : f.lastPathComponent
                        let real = from.appendingPathComponent(name)
                        guard (try? Self.download(real, timeout: 60)) != nil else { continue }
                        try? fm.copyItem(at: real, to: to.appendingPathComponent(name))
                    }
                }
            }.value
            try await NodeHost.shared.restore(from: tmp)
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    /// Sicherung aus einer Datei (Dateien-App, AirDrop): .db prüfen und übernehmen
    func restore(fromFile file: URL) async throws {
        let tmp = fm.temporaryDirectory.appendingPathComponent("restore-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: tmp) }
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        try fm.copyItem(at: file, to: tmp.appendingPathComponent("bookshelv.db"))
        try await NodeHost.shared.restore(from: tmp)
    }

    /// Sicherung als Datei zum Teilen/Speichern (nur Datenbank – Cover holt sich die App neu)
    func exportFile() async throws -> URL {
        let tmp = fm.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString)", isDirectory: true)
        _ = try await NodeHost.shared.snapshot(to: tmp)
        let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        let out = tmp.appendingPathComponent("bookshelv-\(day).db")
        try fm.moveItem(at: tmp.appendingPathComponent("bookshelv.db"), to: out)
        return out
    }

    // MARK: Dateien in der iCloud

    nonisolated private static func coordinatedReplace(_ target: URL, with source: URL) throws {
        var err: NSError?
        var inner: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &err) { url in
            do {
                let fm = FileManager.default
                if fm.fileExists(atPath: url.path) { _ = try fm.replaceItemAt(url, withItemAt: source, backupItemName: nil, options: []) }
                else { try fm.copyItem(at: source, to: url) }
            } catch { inner = error }
        }
        if let e = err ?? inner { throw e }
    }

    /// Ordner spiegeln: neue Dateien hinüber, gelöschte entfernen (Dateinamen sind eindeutig, Inhalte ändern sich nie)
    nonisolated private static func mirror(_ from: URL, to: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: to, withIntermediateDirectories: true)
        let src = Set(((try? fm.contentsOfDirectory(atPath: from.path)) ?? []).filter { !$0.hasPrefix(".") && $0 != "preview" })
        let dst = Set(((try? fm.contentsOfDirectory(atPath: to.path)) ?? []).map { name -> String in
            // nicht heruntergeladene iCloud-Dateien heißen „.name.icloud“
            name.hasPrefix(".") && name.hasSuffix(".icloud") ? String(name.dropFirst().dropLast(7)) : name
        })
        for name in src.subtracting(dst) {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: from.appendingPathComponent(name).path, isDirectory: &isDir), !isDir.boolValue else { continue }
            try coordinatedReplace(to.appendingPathComponent(name), with: from.appendingPathComponent(name))
        }
        for name in dst.subtracting(src) {
            var err: NSError?
            NSFileCoordinator().coordinate(writingItemAt: to.appendingPathComponent(name), options: .forDeleting, error: &err) { try? fm.removeItem(at: $0) }
        }
    }

    /// iCloud-Datei herunterladen lassen und warten, bis sie da ist
    @discardableResult
    nonisolated private static func download(_ url: URL, timeout: TimeInterval) throws -> URL {
        let fm = FileManager.default
        try? fm.startDownloadingUbiquitousItem(at: url)
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            let v = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
            if v?.ubiquitousItemDownloadingStatus == .current || (v?.ubiquitousItemDownloadingStatus == nil && fm.fileExists(atPath: url.path)) { return url }
            Thread.sleep(forTimeInterval: 0.3)
        }
        throw NodeHost.HostError(T("Die Sicherung lädt nicht aus der iCloud.", "The backup does not download from iCloud."))
    }
}
