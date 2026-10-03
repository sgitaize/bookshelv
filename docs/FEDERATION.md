# Federation (plan)

The idea is that separate bookshelv instances can be linked, a bit like Matrix homeservers or Mastodon instances. Someone on `books.anna.example` should be able to lend a book to a friend on `bookshelv.aize-it.de`, and reviews can be visible across instances.

This is built (since the fifth iteration): linking instances, federated reviews and lending across instances. Comments are not federated yet.

## Ground rules

1. **Linking, not an open network.** By default two instances only exchange data after both admins have agreed to the link (an allowlist). That keeps spam out and makes it obvious which operators data goes to, which matters for GDPR. An open mode could come later as an option.
2. **Only what is explicitly shared leaves the instance.** Reviews only if their visibility is `federated`; lending only when a remote person is involved. Shelves, private notes and passwords always stay local.
3. **Keep it small.** A signed JSON protocol over HTTPS with Ed25519 keys from `node:crypto`, no extra dependencies. ActivityPub/BookWyrm compatibility is possible later.
4. **Books are matched by ISBN.** Every instance has its own catalogue; the ISBN-13 ties them together. Books without an ISBN can't be federated.

## Addressing

Users are addressed like e-mail or Mastodon handles: `@anna@books.anna.example`. Everyone finds their own address in the settings.

## Protocol

Instead of full ActivityPub, bookshelv uses a small signed JSON protocol. It has no dependencies and is easy to follow; ActivityPub/BookWyrm compatibility can still be added later.

- `GET /api/fed/info` returns software, version, name, public URL and the instance's public key.
- `POST /api/fed/inbox` receives messages. Every request carries `x-bs-origin` (sender URL), `x-bs-date` (ISO time, at most five minutes off) and `x-bs-signature`, an Ed25519 signature over `<date>\n<sha256 of the body>`.
- `POST /api/fed/lookup` (signed, linked instances only) resolves a username before lending.

Each instance creates its Ed25519 key pair on first use (`node:crypto`). Messages from instances that aren't linked are rejected, with one exception: the link request itself. For that one, the receiver fetches `/api/fed/info` from the claimed sender URL and checks the signature against that key, so nobody can pretend to be another instance.

## Linking two instances

```
Admin A                     Instance A                     Instance B                    Admin B
   │ "link books.anna.example"  │                              │                             │
   │───────────────────────────▶│ ── LinkRequest (signed) ────▶│ fetches A's key, verifies   │
   │                            │                              │  request shows in admin ───▶│
   │                            │◀───── LinkAccept ────────────│◀────────── "accept" ────────│
   │                            │  status: linked              │  status: linked             │
```

If both admins request a link at the same time, the instances link right away. Either side can unlink at any time (`Unlink`); the other side then deletes everything it stored from that instance. Loans to people over there are kept as plain names.

## Messages

| Message | Meaning |
|---|---|
| `LinkRequest` / `LinkAccept` / `Unlink` | Linking and unlinking |
| `Review` / `ReviewDelete` | A review with visibility "federated" was written, changed, made non-federated or deleted. Matched by ISBN-13. After linking, all existing federated reviews are sent. |
| `LoanOffer` | Someone lends a book to a user of the receiving instance (sent again when the due date changes) |
| `LoanReturn` | Either side marks the book as returned (`loanOf` says whose loan it is) |
| `LoanDelete` | The lender deleted the loan record |

Outgoing messages go through a queue in SQLite (`outbox`). It is processed every minute and whenever requests come in, which matters under Passenger because idle processes are put to sleep. Failed deliveries are retried after 1, 5 and 30 minutes, then 2, 6 and 12 hours, and dropped after three days.

The borrower sees a loan from another instance under "Borrowed" and gets a notification. If the book isn't in their catalogue yet, their instance imports it by ISBN so the cover shows up.

## Configuration

The instance needs to know its public URL. Set `BOOKSHELV_PUBLIC_URL`, or let the admin page remember it on first visit (https is assumed except for localhost). For local testing with plain http set `BOOKSHELV_FED_ALLOW_HTTP=1`.

## Privacy

- The admin area records when an instance was linked, and the privacy notice lists linked instances.
- Users choose per review whether it is federated. The default is the own instance only.
- When an account is deleted, the instance sends `Delete(Actor)` to all linked instances, which then remove everything from that user.

## Not done yet

- Federated comments
- Federated reviews in the feed (they currently show on the book page only)
- An open mode for any ActivityPub server (Mastodon, BookWyrm)
