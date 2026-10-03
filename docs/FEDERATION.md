# Föderation – Konzept

**Ziel:** Mehrere bookshelv-Instanzen lassen sich koppeln – ähnlich wie Matrix-Homeserver oder Mastodon-Instanzen. Wer auf `buecher.anna.de` ist, kann einem Freund auf `bookshelv.aize-it.de` ein Buch leihen, und Reviews können über Instanzgrenzen hinweg sichtbar sein.

Status: **geplant für Iteration 5.** Das Datenmodell ist schon darauf vorbereitet (Review-Sichtbarkeit `private | instance | federated`).

## Grundsätze

1. **Kopplung statt offenes Netz (Standard).** Instanzen tauschen nur Daten aus, wenn beide Admins der Kopplung zugestimmt haben (Allowlist). Das hält Spam fern und ist DSGVO-freundlich: Es ist immer klar, an welche Betreiber Daten gehen. Ein „offener Modus“ kann später als Option dazukommen.
2. **Nur explizit Geteiltes verlässt die Instanz.** Reviews nur mit Sichtbarkeit `federated`, Verleih nur, wenn eine entfernte Person beteiligt ist. Regale, Notizen und Passwörter bleiben immer lokal.
3. **Standards statt Eigenbau.** Wir nutzen das Vokabular von **ActivityPub** (W3C) mit **WebFinger** und **HTTP Signatures** – wie Mastodon und [BookWyrm](https://joinbookwyrm.com). So bleibt später eine Anbindung an BookWyrm/Mastodon möglich.
4. **Bücher sind global über die ISBN identifiziert.** Jede Instanz hat ihren eigenen Katalog; über die ISBN-13 wird zugeordnet. Bücher ohne ISBN können nicht föderiert werden.

## Adressierung

Nutzer werden wie bei E-Mail/Mastodon adressiert: `@anna@buecher.anna.de`

- `GET /.well-known/webfinger?resource=acct:anna@buecher.anna.de` → Actor-URL
- `GET /ap/users/anna` → Actor (JSON-LD) mit Name, Inbox und öffentlichem Schlüssel
- `GET /.well-known/nodeinfo` → Software, Version, Kopplungsstatus

## Kopplung zweier Instanzen

```
Admin A                       Instanz A                       Instanz B                     Admin B
   │ "buecher.anna.de koppeln"   │                               │                              │
   │────────────────────────────▶│  Follow(Instanz-Actor)  ─────▶│                              │
   │                             │                               │  Anfrage im Admin-Bereich ──▶│
   │                             │◀─────  Accept(Follow)  ───────│◀──────── "Annehmen" ─────────│
   │                             │  Status: gekoppelt            │  Status: gekoppelt           │
```

Jede Instanz hat einen eigenen Schlüssel (Ed25519, beim ersten Start erzeugt). Alle Server-zu-Server-Anfragen werden signiert. Anfragen von nicht gekoppelten Instanzen werden abgelehnt. Eine Kopplung kann jederzeit von beiden Seiten gelöst werden; die andere Seite löscht daraufhin die zwischengespeicherten Daten.

## Was wird ausgetauscht?

| Vorgang | Activity | Empfänger |
|---|---|---|
| Review mit Sichtbarkeit „föderiert“ veröffentlichen/ändern/löschen | `Create` / `Update` / `Delete` eines `Review` (BookWyrm-kompatibel: `inReplyToBook` mit ISBN, `rating`, `content`) | alle gekoppelten Instanzen |
| Kommentar zu einem föderierten Review | `Create(Note)` mit `inReplyTo` | Instanz des Review-Autors (verteilt weiter) |
| Buch an `@bob@andere.instanz` verleihen | `Offer` eines `bookshelv:Loan` (ISBN, Titel, Cover-URL, Datum, Fälligkeit) | Bobs Instanz |
| Bob bestätigt den Erhalt (optional) | `Accept(Offer)` | Instanz des Verleihers |
| Rückgabe | `Update` des Loans mit `returnedAt` | beide Seiten |

Bob sieht das Buch auf seiner eigenen Instanz unter **„Ich habe gerade geliehen“**, obwohl es in Annas Regal steht.

## Technische Umsetzung

- **Neue Tabellen:** `instances` (Domain, Status, Schlüssel, Kopplungsdatum), `remote_actors` (Handle, Actor-URL, Inbox, Name), `outbox` (Zustellwarteschlange mit Retry), `remote_reviews`
- **Erweiterungen:** `loans.borrower_remote_id`, `reviews.ap_id`
- **Zustellung:** Warteschlange in SQLite, abgearbeitet von einem Timer im Prozess und zusätzlich bei eingehenden Anfragen (wichtig unter Passenger, wo Prozesse schlafen gelegt werden). Exponentielles Backoff, nach 3 Tagen wird aufgegeben.
- **Eingang:** `POST /ap/inbox` prüft die HTTP Signature, die Kopplung und die Größe (max. 256 KB). Verarbeitung idempotent über die Activity-ID.
- **Keine neuen Abhängigkeiten:** Signaturen mit `node:crypto`, JSON-LD wird als reines JSON behandelt.

## Datenschutz

- Die Kopplung wird in der Admin-Oberfläche mit Datum protokolliert; die Datenschutzerklärung listet die gekoppelten Instanzen.
- Nutzer entscheiden pro Review, ob es föderiert wird (Standard: nur die eigene Instanz).
- Wird ein Konto gelöscht, schickt die Instanz `Delete(Actor)` an alle gekoppelten Instanzen, die daraufhin alle Daten dieses Nutzers entfernen.

## Offene Fragen

- Soll es zusätzlich einen offenen Modus geben (alle ActivityPub-Server, z. B. Reviews in Mastodon folgen)?
- Föderierte Reviews automatisch im Feed anzeigen oder nur auf der Buchseite?
