# TeleDrive

A personal cloud drive that stores your files in **Telegram**: unlimited storage, a web app, an **Android app** and a **Windows app**. There's **no backend server**; the app runs on your device and talks to Telegram directly.

> **Website: https://teledrive-storage.vercel.app** · Status: **Phase 9 (public release)**. See the [roadmap](#roadmap).

## Features

- Log in with your Telegram account (phone → code → 2FA password)
- Files are stored in a private channel (**TeleDrive Storage**) in your own account, created automatically
- Upload multiple files with drag-and-drop, with progress, speed, pause and cancel
- Files over 2 GB are split into chunks automatically
- Download files (streamed straight to disk in Chrome/Edge, so size isn't limited by memory)
- Folders: create, rename, move, delete, nest
- Grid and list views, sorting, breadcrumbs, storage stats
- Syncs between devices automatically
- Thumbnails for photos and videos (made in the browser at upload time)
- Previews: photo gallery (swipe, zoom, arrow keys), **video/audio streaming with seeking**, PDF (with zoom),
  Word (.docx), PowerPoint (.pptx), Excel/CSV (.xlsx, .xls, .ods, .csv), Markdown, text/code, and ZIP contents
- Search across all folders (ignores case and accents), plus Photos / Videos / Documents / Audio filters
- Recent, Starred, and Trash (restore, delete forever, auto-emptied after 30 days, Undo)
- Multi-select: checkboxes, Ctrl/Cmd-click, Shift-click, Ctrl+A, long-press on phones; bulk download/move/star/trash
- Interrupted uploads resume: retry, or pick the same file again, even after closing the page
- **Everything encrypted**: files, names and thumbnails are encrypted on your device with your **TeleDrive
  password** before they reach Telegram (Telegram never sees it); streaming and previews still work
- **Locked files and folders**, each with its own password; a locked folder hides its contents
- **Duplicate detection**: warns before uploading a file that's already in the drive
- **Folder upload** (button or drag-and-drop) keeps the folder structure; **folders download as ZIP**
- **Send to Telegram**: send a (decrypted) copy of a file to any chat or contact
- **Multiple drives** (e.g. Personal, Work), each its own private channel, with a switcher
- **Get the app** on the website: download links for the Windows and Android apps
- **Settings:** theme, compact density, thumbnails on/off, auto-lock time, lock on close, lock everything,
  active sessions (log other devices out), check for updates
- **Soft Swiss design** ([DESIGN.md](DESIGN.md)): light and dark themes with a System / Light / Dark switch;
  works at phone width with bottom tabs, a + button and slide-up action sheets

**Windows app** (same code, wrapped with Electron): installs like any program, opens from the Start menu,
no server to run.

**Android app** (same code, wrapped with Capacitor):

- "Share → TeleDrive" from any app (Gallery, Files, WhatsApp…), then pick a folder
- Camera backup: new photos/videos go to a *Camera Backup* folder (Wi-Fi only option); pick more folders
  (Screenshots, WhatsApp Images…) and turn on **backup while the app is closed**
- Downloads are saved to **Downloads/TeleDrive**; "Open with…" hands files to other apps (PDFs, documents)
- Transfers keep running in the background, with progress in a notification
- Back button closes previews/dialogs, then goes up a folder

## How it works

```
 Your browser / phone ──── MTProto (WebSocket) ────► Telegram
   • GramJS                                            private channel =
   • IndexedDB cache                                   files + metadata
```

- Every file is a message in your private channel. Its caption holds small JSON metadata (name, folder, size…).
- Folders are small marker messages with an ID; files point to their folder's ID.
- The app caches everything in IndexedDB and fetches only what changed (`updates.getChannelDifference`).
- Document previews (Word, PowerPoint, spreadsheets, Markdown) render inside a **sandboxed frame**
  that can't reach the app's storage or the network, so a malicious document can't touch your session.
- Video/audio streaming: a service worker (`public/sw.js`) turns the player's byte-range requests into
  Telegram downloads of just those bytes, so you can seek without downloading the whole file.

Full details: [REQUIREMENTS.md](REQUIREMENTS.md) · [IMPLEMENTATION.md](IMPLEMENTATION.md) · [DESIGN.md](DESIGN.md)

## Getting started

### 1. Prerequisites

- [Node.js](https://nodejs.org) 20+
- Telegram API keys: log in at [my.telegram.org](https://my.telegram.org) → **API development tools** → create an app (any title) → copy **api_id** and **api_hash**

### 2. Install

```bash
git clone https://github.com/samarthbc/teledrive.git
cd teledrive
npm install
cp .env.example .env
```

Put your keys in `.env`:

```
VITE_TG_API_ID=12345678
VITE_TG_API_HASH=your32characterhashhere
```

`.env` is git-ignored. Never commit it. If you leave it empty, the app asks for the keys on first launch and stores them on that device only.
Public builds (website, release apps) never include these keys: everyone enters their own on the Setup screen.

### 3. Run

```bash
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/ (with your keys, for yourself)
```

## Public release

The website and the downloadable apps are built **without** API keys; each person enters their own on the
Setup screen (once per device).

```bash
npm run build:website     # the website (dist/), with a Content-Security-Policy
npm run android:release   # then: cd android && ./gradlew assembleRelease  (signed APK)
npm run desktop:release   # %LOCALAPPDATA%\TeleDrive-build\TeleDrive-Setup.exe
```

Every public build runs `scripts/check-keys.mjs`, which fails if your api_hash is inside it.

- **Website:** https://teledrive-storage.vercel.app, hosted on Vercel (`vercel.json`), deployed on every push to `main`.
- **Apps:** pushing a tag `v<version>` runs `.github/workflows/release.yml`, which builds the signed APK and
  the Windows installer and publishes them as a GitHub Release. The website's **Get the app** links always
  point to the latest one.
- **Updates:** the Windows app downloads new versions by itself and installs them when it closes (or via
  **Restart to update**); the Android app shows **Update** in the side menu, then Android's installer.
  Nobody reinstalls, and logins and files are kept.

Details and first-time setup (Vercel, GitHub secrets, the Android signing key): IMPLEMENTATION.md Phase 9.

## Android app

Requirements: Android Studio (includes the right Java). The app runs on Android 10 or newer.

```bash
npm run android        # build the web app, copy it into android/, open Android Studio
```

In Android Studio, connect your phone (USB debugging on) and press **Run ▶**. Or use
**Build → Build App Bundle(s) / APK(s) → Build APK(s)** and copy
`android/app/build/outputs/apk/debug/app-debug.apk` to your phone.

After changing the web code, run `npm run android:sync` and press Run again.

Building from a terminal instead: point `JAVA_HOME` at Android Studio's Java, then
`cd android && ./gradlew assembleDebug`.

## Windows app

```bash
npm run desktop:build    # builds the installer into %LOCALAPPDATA%\TeleDrive-build
```

Run `TeleDrive-Setup.exe` from that folder. It installs for your user only (no admin), adds
TeleDrive to the Start menu and desktop, and keeps you logged in between launches. It isn't signed, so
Windows may say "Unknown publisher" the first time: **More info → Run anyway**. After code changes, build
and run the installer again. `npm run desktop` opens the app without installing it.

The installer contains the API keys from your `.env`, so keep it to yourself.

## Project structure

```
src/
├── telegram/   client, login flow, storage channel, message parsing
├── drive/      metadata format, folder tree, sync, upload (resumable), download, streaming,
│               thumbnails, file ops (trash/star), transfer queue
├── db/         IndexedDB (Dexie): session, cache, settings
├── store/      app state (Zustand)
├── pages/      Setup, Login, TeleDrive password, Drive
├── components/ file views, preview, dialogs, menus, transfer panel, shared form controls (ui.tsx)
├── lib/        formatting, theme switch, releases and app updates
├── dev/        sample files for design work (`?mock`, development only, never shipped)
└── native/     Android bridge (downloads, share-to-app, camera backup, notification, back button); desktop bridge
public/sw.js    service worker for video/audio streaming
android/        Android project (Capacitor); native code in app/src/main/java/com/samarthbc/teledrive/
electron/       Windows app (Electron): window, serving the app's files, preload
```

## Privacy and safety

- Your files live in **your own** Telegram account. The API keys only identify the app; they don't give access to anyone's files.
- Everything is encrypted with your **TeleDrive password** before it reaches Telegram. It can't be changed or
  recovered: if you forget it, your files are lost. Keep it in a password manager.
- Telegram doesn't guarantee storage. Don't keep the **only** copy of important files here.
- Heavy automated use can trigger rate limits. The app waits and retries automatically.
- Don't post or delete messages in the **TeleDrive Storage** channel by hand.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Project setup | ✅ |
| 1 | Login, storage channel, upload/download, chunking, folders, rename/move/delete, sync | ✅ |
| 2 | Thumbnails, previews, video streaming, search, trash, multi-select, resume uploads | ✅ |
| 3 | Android app (Capacitor), share-to-app, camera backup, background transfers | ✅ Tested on a Redmi (Android 14) |
| 4 | End-to-end encryption, duplicate detection, folder upload, ZIP download, send to Telegram, multiple drives, PWA | ✅ Being tested |
| 5 | Camera backup upgrades: backup while the app is closed, more folders | ✅ Being tested |
| 6 | Security: TeleDrive password (every file encrypted), locked files and folders with their own passwords | ✅ Being tested |
| 7 | UI redesign (Soft Swiss): light/dark themes and switch, every screen restyled | ✅ Being tested |
| 8 | Windows desktop app (Electron): installer, no server needed | ✅ Being tested |
| 9 | Public release: website on Vercel, downloads for the apps, everyone enters their own API keys | ✅ Website live; app release needs the GitHub secrets |
| 10 | Settings: density, thumbnails, auto-lock time, lock on close, lock everything, active sessions, check for updates | ✅ Being tested |

## Tech stack

React · TypeScript · Vite · Tailwind CSS · [GramJS](https://github.com/gram-js/gramjs) · Dexie · Zustand · Vitest · Capacitor (Android) · Electron (Windows)
