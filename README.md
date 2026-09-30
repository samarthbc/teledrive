# TeleDrive

A personal cloud drive that stores your files in **Telegram**: unlimited storage, a web app, and an **Android app**. There's **no backend server**; the app runs on your device and talks to Telegram directly.

> Status: **Phase 3 (Android app)**. See the [roadmap](#roadmap).

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
- Previews: photo gallery (swipe, zoom, arrow keys), **video/audio streaming with seeking**, PDF, text/code
- Search across all folders (ignores case and accents), plus Photos / Videos / Documents / Audio filters
- Recent, Starred, and Trash (restore, delete forever, auto-emptied after 30 days, Undo)
- Multi-select: checkboxes, Ctrl/Cmd-click, Shift-click, Ctrl+A, long-press on phones; bulk download/move/star/trash
- Interrupted uploads resume: retry, or pick the same file again, even after closing the page
- Works at phone width; follows your system's dark/light mode

**Android app** (same code, wrapped with Capacitor):

- "Share → TeleDrive" from any app (Gallery, Files, WhatsApp…), then pick a folder
- Camera backup: new photos/videos go to a *Camera Backup* folder (Wi-Fi only option)
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
- Video/audio streaming: a service worker (`public/sw.js`) turns the player's byte-range requests into
  Telegram downloads of just those bytes, so you can seek without downloading the whole file.

Full details: [REQUIREMENTS.md](REQUIREMENTS.md) · [IMPLEMENTATION.md](IMPLEMENTATION.md)

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

### 3. Run

```bash
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/
```

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

## Project structure

```
src/
├── telegram/   client, login flow, storage channel, message parsing
├── drive/      metadata format, folder tree, sync, upload (resumable), download, streaming,
│               thumbnails, file ops (trash/star), transfer queue
├── db/         IndexedDB (Dexie): session, cache, settings
├── store/      app state (Zustand)
├── pages/      Setup, Login, Drive
├── components/ file views, preview, dialogs, menus, transfer panel
└── native/     Android bridge: downloads, share-to-app, camera backup, notification, back button
public/sw.js    service worker for video/audio streaming
android/        Android project (Capacitor); native code in app/src/main/java/com/samarthbc/teledrive/
```

## Privacy and safety

- Your files live in **your own** Telegram account. The API keys only identify the app; they don't give access to anyone's files.
- Normal Telegram channels are **not end-to-end encrypted**. Optional client-side encryption is planned (Phase 4).
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
| 4 | End-to-end encryption, duplicate detection, ZIP download, deploy | ⏳ |
| 5 | Camera backup upgrades: backup while the app is closed, more folders | ⏳ Later |

## Tech stack

React · TypeScript · Vite · Tailwind CSS · [GramJS](https://github.com/gram-js/gramjs) · Dexie · Zustand · Vitest · Capacitor (Android)
