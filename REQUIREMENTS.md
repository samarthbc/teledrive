# TeleDrive — Requirements

A personal cloud drive that uses Telegram as unlimited storage, with a website and a mobile app. There is **no backend server**: the apps talk to Telegram directly.

---

## 1. Goals

- Unlimited, free cloud storage built on Telegram
- Manage files from both a **website** and an **Android app** (iOS is not a goal)
- **No hosted backend**: nothing to run or pay for
- Automatic sync between all devices

## 2. Architecture

```
 ┌───────────────────────────┐
 │  TeleDrive app            │
 │  (web + mobile)           │
 │  • GramJS (Telegram lib)  │──── MTProto over WebSocket ────► Telegram servers
 │  • runs on the device     │                                  (private channel:
 │  • local cache of index   │                                   files + metadata)
 └───────────────────────────┘
```

### 2.1 Authentication
- The user logs in with their Telegram account: phone number, login code, then 2FA password if enabled.
- GramJS produces a **session string**, stored locally on the device in IndexedDB.
- Each device logs in once, like adding a new Telegram device.

### 2.2 Storage
- On first run, the app creates a private channel (e.g. "TeleDrive Storage"). If one already exists, the app finds and reuses it.
- Every file is uploaded as a message (document) in that channel.

### 2.3 Metadata ("database" in Telegram)
Each file message has a JSON caption that serves as its metadata:

```json
{"td":1, "t":"f", "id":"a8f3", "p":"k3j9", "n":"beach.jpg", "s":4821930, "of":1}
```

Folders are marker messages with their own ID (`{"td":1, "t":"d", "id":"k3j9", "p":"root", "n":"Photos"}`), and each item stores its parent folder's ID in `p`. Renaming or moving a folder therefore edits only one message. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the full format.

| Operation | Implementation |
|---|---|
| List folder | Read channel messages, group by parent ID `p` |
| Rename / move | Edit one message caption |
| Delete | Delete the message(s) |

- All devices read the same channel, so sync between devices is automatic.
- A local cache (IndexedDB) of the index gives fast startup; only new or changed messages are fetched incrementally.

### 2.4 Large files
- Files are split into chunks (e.g. 512 MB), because Telegram limits each file to 2 GB (4 GB with Premium).
- Each chunk is a separate message with `part` / `of` fields and a shared file `id`.
- On download, the parts are fetched in order and joined.

### 2.5 Streaming
- Video and audio are streamed through a **service worker** that answers HTTP Range requests by fetching only the needed byte range from Telegram. This allows seeking without a full download.

## 3. Tech Stack

| Piece | Choice |
|---|---|
| App | React + TypeScript (Vite) |
| Telegram | GramJS |
| Local storage | IndexedDB |
| Mobile | Capacitor 7 (wraps the web app into a native Android app; Android 10+) |
| Desktop | Electron (wraps the web app into a Windows app with an installer) |
| Website hosting | Vercel (static files only, no server code); app downloads on GitHub Releases |

### Configuration
- `api_id` and `api_hash` from https://my.telegram.org (API development tools)
- Stored in a local `.env` file. **Never commit it.**

---

## 4. Features

### 4.1 Core (MVP)

**Account & setup**
- [x] Log in with Telegram (phone, code, 2FA)
- [x] Auto-create or find the storage channel on first launch
- [x] Persist the session per device
- [x] Log out

**File management**
- [x] Upload files, several at once, with drag-and-drop on the website
- [x] Download files
- [x] Folders: create, rename, delete, nesting
- [x] Rename, move, and delete files
- [x] Upload/download progress bars with pause and cancel
- [x] Automatic chunking of files over 2 GB

**Browsing**
- [x] Grid view and list view
- [x] Sort by name, date, size, or type
- [x] Breadcrumb navigation (`Home › Photos › 2026`)
- [x] File details: size, type, upload date, uploading device
- [x] Storage stats: total files and total size used

### 4.2 Quality of life

**Previews**
- [x] Image thumbnails and a full-screen gallery viewer
- [x] Video player with seeking (streamed)
- [x] Audio player
- [x] PDF and text file preview
- [x] Office previews: Word (.docx), PowerPoint (.pptx), Excel/CSV, Markdown, ZIP contents (rendered in a sandbox)

**Organization**
- [x] Search by file name across all folders
- [x] Filters: Photos, Videos, Documents, Audio (search the whole drive)
- [x] Favorites / starred files
- [x] Recent files
- [x] Trash bin with restore (hidden trash path, auto-deleted after 30 days)
- [x] Multi-select for bulk move, delete, or download

**Sync & performance**
- [x] Local cache so the file list opens instantly
- [x] Automatic sync between devices
- [x] Resume interrupted uploads

### 4.3 Mobile-specific
- [x] Share-to-app: share from any app (e.g. the gallery) and upload directly
- [x] Automatic camera backup of new photos and videos (on iOS, runs when the app is opened because background uploads are limited)
- [x] Offline access to downloaded files (saved to Downloads/TeleDrive)
- [x] Open files in other apps

### 4.4 Advanced
- [x] End-to-end encryption: client-side encryption with a user password before upload (redone in §4.6)
- [x] Duplicate detection via file hashes
- [x] Folder upload that keeps its structure
- [x] Download a folder as a ZIP
- [x] Share with Telegram users by sending to a chat
- [x] Multiple storage channels (e.g. Personal, Work)
- [x] Installable PWA for desktop (button removed in Phase 9; replaced by downloads of the real apps)

### 4.5 Later: camera backup upgrades (Android)
- [x] Automatic backup while the app is closed (Android runs it in the background when new photos appear)
- [x] Back up more folders (Screenshots, WhatsApp Images, …), each into its own subfolder

### 4.6 Security
- [x] **TeleDrive password**, created at first login and entered on each new device (after Telegram's own login);
      checked against a check value stored on Telegram; remembered on the device; can't be changed or recovered
- [x] Every file encrypted before it reaches Telegram (contents, names, thumbnails); Telegram never gets the password
- [x] **Locked files and folders**, each with its own file/folder password; a locked folder hides its contents;
      nested locks need each password
- [x] Locking, removing a lock or changing an item's password requires the TeleDrive password
- [x] Deleting locked items (trash, delete forever, empty trash; also when inside a folder) requires the TeleDrive password
- [x] Locked items relock after 5 minutes idle or when the app closes; they can't be sent to chats
- [x] Sending normal files to Telegram chats still works (a decrypted copy is uploaded)

### 4.7 UI updates
- [x] Dark and light theme with a manual switch (System / Light / Dark, saved on the device)
- [x] New design across the website and app: Soft Swiss (see DESIGN.md)
- [x] Phone layout: bottom tabs, + button, slide-up action sheets

### 4.8 Windows desktop app
- [x] Installable Windows app that works without running a local server or putting the website online
- [x] Stays logged in between launches; one window; remembers its size and position
- [x] Downloads, uploads, previews and video streaming work as in the browser
- [x] Title bar follows the app's theme

### 4.9 Public release
- [x] Website online (Vercel): https://teledrive-storage.vercel.app
- [x] Download links on the website for the Windows app and the Android app (GitHub Releases)
- [x] No API keys in any public build; the website and both apps ask for them on a Setup screen
- [x] Setup: clear message for wrong keys, a way to change keys, a short explanation
- [x] Apps show their version and say when a newer one is available
- [x] Updates install over the existing apps (no reinstall, data kept): automatic on Windows, one tap on Android
- [x] Security headers (Content-Security-Policy) on the website

### 4.10 Settings
- [x] A Settings page (side menu), per device, on the website and both apps
- [x] Density: comfortable / compact
- [x] Thumbnails on / off
- [x] Auto-lock time for unlocked items: 1 / 5 / 15 / 30 minutes
- [x] Lock TeleDrive when it closes (ask the TeleDrive password every start)
- [x] Lock everything now
- [x] Active sessions: see devices logged in to the Telegram account, log one or all others out
- [x] Check for updates (and the version)

### 4.11 TelePhotos (Google Photos–style, separate from files)
- [x] A second built-in drive, **TelePhotos**, next to My Drive; only photos and videos; can't be renamed or deleted
- [x] Camera backup lives in TelePhotos (camera → Camera, other phone folders → their own folder)
- [x] Backup keeps working whichever drive was left open
- [x] Timeline by date taken, source filters, favorites, trash, locked
- [x] ~~Move existing Camera Backup folders from My Drive to TelePhotos~~ (not needed: none exist)
- [x] Each folder backed up as photos are taken, or once a day overnight (optionally only while charging)
- [x] Albums: a photo in several albums; deleting an album keeps its photos
- [x] New album from + New and the + button
- [x] Free up space: remove backed-up photos from the phone (after an "Are you sure?" and Android's own prompt)
- [x] Share an album to a Telegram chat (as Telegram albums); download an album as a ZIP
- [x] Search photos by date ("dec 2024", "last summer"), kind (videos, starred, large), folder, album or name
- [ ] Locked photos: a default album behind the TeleDrive password; locked photos are in no other album (Phase 17)
- [ ] Camera backup from a date range: every photo and video taken between two dates, when turning backup on or for a folder already backed up (Phase 18)
- [ ] Later: on this day, map, smart search (what's in a photo, on the device)

### 4.12 TeleWarden (password manager and authenticator, Bitwarden-style)
A third built-in drive, **TeleWarden**, next to My Drive and TelePhotos. UI prototype: `design/8-telewarden/prototype.html`.

**The drive (Phase 19)**
- [ ] Its own channel; listed in the drive picker after TelePhotos; created the first time it's opened; can't be renamed or deleted
- [ ] Its own **master password**, created the first time: never stored anywhere, only the user knows it (the
      TeleDrive password stays remembered on the device for camera backup and the drives, and doesn't open TeleWarden)
- [ ] The master password must be **strong**: at least 12 characters, rated Strong or Very strong, and not the same as
      the TeleDrive password; typed twice; optional hint (encrypted, shown only on the user's devices)
- [ ] A **recovery code**, shown once at creation, opens the vault if the master password is forgotten (then a new
      master password and a new code are set); a new code can be made in Settings
- [ ] Forgotten master password and no recovery code: **Reset TeleWarden** (asks the TeleDrive password) deletes the
      vault and starts over; nothing else is touched
- [ ] Change the master password in Settings (nothing is re-encrypted; only the vault key is wrapped again)
- [ ] Its own lock, separate from My Drive's locked items; growing delays after wrong passwords
- [ ] Locks after 1 / 5 / 15 / 30 minutes without activity, or when TeleDrive closes; **Lock now** in the sidebar card
- [ ] Everything encrypted on the device (names, types, every field); Telegram only stores ciphertext; each item tied
      to its ID and padded, so items can't be swapped or rolled back unnoticed and their sizes say little
- [ ] The website gets a strict Content-Security-Policy (only its own scripts; only Telegram and Have I Been Pwned)
- [ ] Syncs between devices like files do

**Items (Phase 19)**
- [ ] **Login:** name, username, password, 2FA secret, websites (several), notes
- [ ] **Card:** name, cardholder, number (brand detected: Visa, Mastercard, RuPay, Amex…), expiry, security code
- [ ] **Identity:** title, first / middle / last name, email, phone (+91 default), address, city, state, PIN code,
      country; Aadhaar, PAN, passport, driving licence, voter ID; username, company
- [ ] **Secure note:** free text
- [ ] Custom fields on any item (text or hidden); password history (last 5) on logins
- [ ] Folders, favorites, trash (deleted forever after 30 days), restore, delete forever, clone, move to folder
- [ ] Search (name, username, website); filter by type and folder
- [ ] Show / hide secret fields; copy any field; the clipboard clears itself (10 s / 30 s / 1 min / never)
- [ ] Password generator (length, A-Z, a-z, 0-9, symbols, avoid look-alikes) and passphrase generator (words,
      separator, capitals, number), with history; dice button in the login form; strength meter while typing
- [ ] Phone: bottom tabs (Vault, Generator, Report, Settings), + button, items open in a bottom sheet

**Authenticator (Phase 20)**
- [ ] TeleWarden is an authenticator app: 6/8-digit codes (TOTP) with a countdown, on any login, refreshed live
- [ ] Add a code by scanning a QR code (Android camera, or a screenshot / image), pasting the key or an `otpauth://` link
- [ ] **Import from Google Authenticator** (its "Export accounts" QR codes, all accounts at once), matched to saved
      logins or added as 2FA-only items
- [ ] A **2FA codes** page with every code; tap to copy
- [ ] Not possible (no export): Microsoft Authenticator, Authy; those sites are set up again by scanning a new QR code

**Unlocking and your data (Phase 21)**
- [ ] Unlock with fingerprint (Android) and with a PIN; the master password is asked again after a restart
- [ ] Block screenshots while TeleWarden is open (Android, Windows app)
- [ ] Import from Bitwarden (.json, .csv), Chrome / Edge, Firefox, LastPass, 1Password (.csv), KeePass (.xml); duplicates skipped
- [ ] Export: password-protected file (opens in Bitwarden too), plain .json, .csv; asks the master password first

**Security report (Phase 22)**
- [ ] Weak, reused, old (over a year), unsecured (http://) and exposed passwords (Have I Been Pwned, opt-in; only a
      5-character hash prefix is sent)
- [ ] Badges in the list, warnings on the item, **Change password** opens the editor with a new generated password

**Android autofill (Phase 23)**
- [ ] Fills logins in other apps and in Chrome (TeleDrive as Android's autofill service); unlock with fingerprint first
- [ ] "Save to TeleWarden?" / "Update password?" after signing in somewhere
- [ ] Suggestions above the keyboard (Android 11+); fills cards and identities into forms too
- [ ] Website matching: base domain, host, starts with, exact, regular expression, never; Android apps by package name

---

## 5. Out of Scope (not possible without a backend)

- Public share links for people without Telegram
- Accounts shared by several users on the same drive (other than sharing the channel itself)
- Server-side processing (e.g. video transcoding)
- TeleWarden: Bitwarden **Send** (public share links), **organizations** / family sharing, **emergency access**
- TeleWarden: autofill on the website and in the Windows app (needs a browser extension, a separate project);
  passkeys (maybe later, Android 14+)

## 6. Constraints & Risks

| Risk | Mitigation |
|---|---|
| **Privacy:** normal Telegram chats are not end-to-end encrypted | Optional client-side encryption (4.4) |
| **Terms of service:** heavy automated use may cause rate limits (`FLOOD_WAIT`) or bans | Respect `FLOOD_WAIT`, throttle requests, recommend a secondary account |
| **No data guarantees** from Telegram | Warn the user; don't make it the only copy of important data |
| **Speed:** free accounts may be throttled | Parallel chunk uploads within limits |
| **Browser memory** on very large downloads | Stream to disk (File System Access API / service worker) instead of into memory |
| **API keys bundled in app** | Acceptable for personal use; the user can supply their own keys |

---

## 7. Roadmap

| Phase | Scope |
|---|---|
| **1** | Login, storage channel, upload, download, folders, rename, delete, move, chunking |
| **2** | Thumbnails, image and video preview, search, multi-select, trash |
| **3** | Mobile app via Capacitor, share-to-app, camera backup |
| **4** | Encryption, duplicate detection, ZIP download, polish |
| **5** | Camera backup upgrades: background backup, more folders (later) |
| **6** | Security: TeleDrive password, locked files and folders |
| **7** | UI redesign |
| **8** | Windows desktop app (Electron) |
| **9** | Public release: website online, app downloads, Setup screen everywhere |
| **10** | Settings: density, thumbnails, auto-lock time, lock on close, lock everything, active sessions, updates |
| **11** | TelePhotos: the drive, photos only, camera backup moved there |
| **12** | TelePhotos: backup from anywhere (app in the background with another drive open) |
| **13** | TelePhotos: date taken, timeline and photo screens |
| **14** | TelePhotos: move existing Camera Backup folders (skipped, not needed) |
| **15** | TelePhotos: per-folder backup timing (as taken / overnight) |
| **16** | TelePhotos: albums, free up space, and more |
| **17** | TelePhotos: Locked photos |
| **18** | Camera backup: back up a date range |
| **19** | TeleWarden: the drive, the vault key and lock, items (login, card, identity, note), folders, trash, generator |
| **20** | TeleWarden: authenticator (2FA codes, QR scan, import from Google Authenticator) |
| **21** | TeleWarden: fingerprint / PIN unlock, block screenshots, import and export |
| **22** | TeleWarden: security report |
| **23** | TeleWarden: Android autofill and save prompt |
