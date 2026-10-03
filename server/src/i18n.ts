/**
 * Fehlermeldungen sind im Code deutsch; schickt das Frontend `x-lang: en`, werden sie hier übersetzt.
 * So bleibt der Code lesbar und neue Meldungen fallen ohne Übersetzung einfach auf Deutsch zurück.
 */
const EN: Record<string, string> = {
  'Interner Fehler': 'Internal error',
  'Unbekannter Endpunkt': 'Unknown endpoint',
  'Aktuelles Passwort falsch': 'Current password is wrong',
  'Benutzername ist schon vergeben': 'This username is already taken',
  'Benutzername oder Passwort falsch': 'Wrong username or password',
  'Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, . _ -': 'Username: 3–32 characters, only letters, digits, . _ -',
  'Bereits eingerichtet': 'Already set up',
  'Bewertung: 0,5 bis 5 Sterne in halben Schritten': 'Rating: 0.5 to 5 stars in half steps',
  'Datum im Format JJJJ-MM-TT': 'Date must be YYYY-MM-DD',
  'Dieses Regal ist privat': 'This shelf is private',
  'Du bist der einzige Admin – ernenne zuerst einen anderen Admin': 'You are the only admin – make someone else admin first',
  'Du kannst dich nicht selbst entmachten oder sperren': 'You cannot remove your own admin rights or block yourself',
  'Eigenes Konto bitte über die Einstellungen löschen': 'Please delete your own account in the settings',
  'Einladung ungültig oder abgelaufen': 'Invitation invalid or expired',
  'Höchstens 10 offene Einladungen': 'At most 10 open invitations',
  'Kommentar ist leer': 'Comment is empty',
  'Nicht angemeldet': 'Not signed in',
  'Nicht erlaubt': 'Not allowed',
  'Nur Ersteller oder Admin dürfen Buchdaten ändern': 'Only the creator or an admin may edit book details',
  'Nur für Admins': 'Admins only',
  'ol oder isbn fehlt': 'ol or isbn missing',
  'Passwort falsch': 'Wrong password',
  'Passwort: mindestens 8 Zeichen': 'Password: at least 8 characters',
  'Setup-Token falsch': 'Wrong setup token',
  'Titel fehlt': 'Title is missing',
  'Ungültige Anfrage (JSON erwartet)': 'Invalid request (JSON expected)',
  'Ungültige ID': 'Invalid ID',
  'Ungültige ISBN': 'Invalid ISBN',
  'Ungültige Zahl': 'Invalid number',
  'Ungültiger Text': 'Invalid text',
  'Dieses Exemplar ist schon verliehen': 'This copy is already lent out',
  'An wen? Person auswählen oder Namen eingeben': 'To whom? Pick a person or enter a name',
  'An dich selbst kannst du nicht verleihen': 'You cannot lend a book to yourself',
  'Rückgabe kann nicht vor dem Verleihdatum liegen': 'The return date cannot be before the lending date',
  'Dieses Exemplar ist gerade verliehen – erst als zurückbekommen markieren': 'This copy is currently lent out – mark it as returned first',
  'Name fehlt': 'Name is missing',
  'Bild fehlt oder hat ein ungültiges Format': 'Image is missing or has an invalid format',
  'Bild ist zu groß': 'Image is too large',
  'Zu viele Fehlversuche – bitte in ein paar Minuten erneut versuchen': 'Too many failed attempts – please try again in a few minutes'
};

const NOUNS: Record<string, string> = {
  Buch: 'Book', Einladung: 'Invitation', Exemplar: 'Copy', Kommentar: 'Comment', Nutzer: 'User', Review: 'Review', Eintrag: 'Entry', Verleih: 'Loan'
};

export function translate(msg: string, lang: string | undefined): string {
  if (lang !== 'en') return msg;
  if (EN[msg]) return EN[msg];
  let m = msg.match(/^(\S+) nicht gefunden$/);
  if (m) return `${NOUNS[m[1]] ?? m[1]} not found`;
  m = msg.match(/^Text zu lang \(max\. (\d+) Zeichen\)$/);
  if (m) return `Text too long (max. ${m[1]} characters)`;
  m = msg.match(/^Erlaubt: (.*)$/);
  if (m) return `Allowed: ${m[1]}`;
  return msg;
}
