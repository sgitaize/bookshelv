# Federation (plan)

The idea is that separate bookshelv instances can be linked, a bit like Matrix homeservers or Mastodon instances. Someone on `books.anna.example` should be able to lend a book to a friend on `bookshelv.aize-it.de`, and reviews can be visible across instances.

This is planned, not built yet. The database is already prepared for it: reviews have a visibility of `private`, `instance` or `federated`.

## Ground rules

1. **Linking, not an open network.** By default two instances only exchange data after both admins have agreed to the link (an allowlist). That keeps spam out and makes it obvious which operators data goes to, which matters for GDPR. An open mode could come later as an option.
2. **Only what is explicitly shared leaves the instance.** Reviews only if their visibility is `federated`; lending only when a remote person is involved. Shelves, private notes and passwords always stay local.
3. **Use existing standards.** The protocol uses the ActivityPub vocabulary with WebFinger and HTTP Signatures, like Mastodon and [BookWyrm](https://joinbookwyrm.com) do. That keeps the door open for talking to BookWyrm or Mastodon later.
4. **Books are matched by ISBN.** Every instance has its own catalogue; the ISBN-13 ties them together. Books without an ISBN can't be federated.

## Addressing

Users are addressed like e-mail or Mastodon handles: `@anna@books.anna.example`

- `GET /.well-known/webfinger?resource=acct:anna@books.anna.example` returns the actor URL
- `GET /ap/users/anna` returns the actor (JSON-LD) with name, inbox and public key
- `GET /.well-known/nodeinfo` returns software, version and link status

## Linking two instances

```
Admin A                     Instance A                     Instance B                    Admin B
   │ "link books.anna.example"  │                              │                             │
   │───────────────────────────▶│  Follow(instance actor) ────▶│                             │
   │                            │                              │  request shows in admin ───▶│
   │                            │◀───── Accept(Follow) ────────│◀────────── "accept" ────────│
   │                            │  status: linked              │  status: linked             │
```

Each instance generates its own key pair (Ed25519) on first start and signs every server-to-server request. Requests from instances that aren't linked are rejected. Either side can remove the link at any time, and the other side then deletes everything it cached from that instance.

## What gets exchanged

| Event | Activity | Sent to |
|---|---|---|
| A federated review is created, edited or deleted | `Create` / `Update` / `Delete` of a `Review` (BookWyrm-compatible: `inReplyToBook` with ISBN, `rating`, `content`) | all linked instances |
| Someone comments on a federated review | `Create(Note)` with `inReplyTo` | the review author's instance, which passes it on |
| Lending a book to `@bob@other.instance` | `Offer` of a `bookshelv:Loan` (ISBN, title, cover URL, date, due date) | Bob's instance |
| Bob confirms he got it (optional) | `Accept(Offer)` | the lender's instance |
| The book comes back | `Update` of the loan with `returnedAt` | both sides |

Bob then sees the book under "currently borrowed" on his own instance, even though it sits on Anna's shelf.

## Implementation notes

- New tables: `instances` (domain, status, key, linked since), `remote_actors` (handle, actor URL, inbox, name), `outbox` (delivery queue with retries), `remote_reviews`.
- Extra columns: `loans.borrower_remote_id`, `reviews.ap_id`.
- Delivery runs from a queue in SQLite, processed by a timer inside the process and additionally whenever requests come in. That matters under Passenger, which puts idle processes to sleep. Retries back off exponentially and give up after three days.
- `POST /ap/inbox` checks the HTTP signature, the link status and the size (256 KB max). Processing is idempotent by activity ID.
- No new dependencies: signatures use `node:crypto`, and JSON-LD is handled as plain JSON.

## Privacy

- The admin area records when an instance was linked, and the privacy notice lists linked instances.
- Users choose per review whether it is federated. The default is the own instance only.
- When an account is deleted, the instance sends `Delete(Actor)` to all linked instances, which then remove everything from that user.

## Open questions

- Should there also be an open mode (any ActivityPub server, e.g. following reviews from Mastodon)?
- Should federated reviews show up in the feed automatically, or only on the book page?
