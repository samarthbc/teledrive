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
- [ ] Website online (Vercel)
- [x] Download links on the website for the Windows app and the Android app (GitHub Releases)
- [x] No API keys in any public build; the website and both apps ask for them on a Setup screen
- [x] Setup: clear message for wrong keys, a way to change keys, a short explanation
- [x] Apps show their version and say when a newer one is available
- [x] Updates install over the existing apps (no reinstall, data kept): automatic on Windows, one tap on Android
- [x] Security headers (Content-Security-Policy) on the website

---

## 5. Out of Scope (not possible without a backend)

- Public share links for people without Telegram
- Accounts shared by several users on the same drive (other than sharing the channel itself)
- Server-side processing (e.g. video transcoding)

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
