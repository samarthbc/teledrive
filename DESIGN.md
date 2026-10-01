# TeleDrive — Design System

The visual design for Phase 7. **Soft Swiss** combines soft neumorphic depth (raised and pressed surfaces) with Swiss typography: big heavy type, black and red, strict alignment.

- **Light theme:** Soft Swiss (warm grey surface).
- **Dark theme:** Dark soft Swiss (graphite surface).

Both themes share the same layout, spacing, radii and components. Only the colour tokens change.

Screenshots of every board are in [`design/`](design/). The final ones are in [`design/1-final-theme/`](design/1-final-theme/).

| | Light | Dark |
|---|---|---|
| Elements | [01](design/1-final-theme/01-light-soft-swiss-elements.png) | [09](design/1-final-theme/09-dark-soft-swiss-elements.png) |
| Desktop · drive + menu | [02](design/1-final-theme/02-light-soft-swiss-desktop-drive.png) | [10](design/1-final-theme/10-dark-soft-swiss-desktop-drive.png) |
| Desktop · grid + lock dialog | [03](design/1-final-theme/03-light-soft-swiss-desktop-grid-lock.png) | [11](design/1-final-theme/11-dark-soft-swiss-desktop-grid-lock.png) |
| Desktop · TeleDrive password | [04](design/1-final-theme/04-light-soft-swiss-desktop-password.png) | [12](design/1-final-theme/12-dark-soft-swiss-desktop-password.png) |
| Phone · file list | [05](design/1-final-theme/05-light-soft-swiss-phone-list.png) | [13](design/1-final-theme/13-dark-soft-swiss-phone-list.png) |
| Phone · photos + backup | [06](design/1-final-theme/06-light-soft-swiss-phone-photos.png) | [14](design/1-final-theme/14-dark-soft-swiss-phone-photos.png) |
| Phone · actions sheet | [07](design/1-final-theme/07-light-soft-swiss-phone-actions.png) | [15](design/1-final-theme/15-dark-soft-swiss-phone-actions.png) |
| Phone · TeleDrive password | [08](design/1-final-theme/08-light-soft-swiss-phone-password.png) | [16](design/1-final-theme/16-dark-soft-swiss-phone-password.png) |

The other folders hold the explorations that led here: `2-mix-neumorphism-swiss`, `3-themes` and `4-layouts`.

---

## 1. Principles

1. **One surface.** The whole app is a single surface colour. Depth comes only from shadows: things you can press are **raised**, and things that hold input or show the current state are **pressed in**.
2. **Type does the hierarchy.** Big, heavy, tightly tracked headings (Archivo 900) carry the structure, not boxes or colour.
3. **Red is a signal.** Red is used only for:
   - the main action;
   - the active or selected state;
   - locked items;
   - destructive actions;
   - progress;
   - focus;
   - Swiss details (section numbers, breadcrumb slashes).

   Everything else is ink or grey.
4. **Never rely on shadow alone.** Soft shadows are low-contrast by nature. Every state change also changes text colour or weight. For example, an active tab is pressed in **and** red **and** extra-bold.
5. **Same app on every screen.** Desktop and phone share every component. Only the shell changes: sidebar on desktop, bottom tabs and a + button on the phone.

---

## 2. Theme switching

- Three modes: **System** (default), **Light** and **Dark**, saved on the device (`localStorage`, key `teledrive.theme`).
- Apply the theme by setting `data-theme="light" | "dark"` on `<html>`. In System mode, follow `prefers-color-scheme` and react live when it changes.
- The sun/moon icon button in the top bar cycles System → Light → Dark. Settings, if added later, gets a 3-way segmented control.
- Set the theme before React renders, using a tiny inline script in `index.html` and `backup.html`, so the page never flashes the wrong theme.
- Update `<meta name="theme-color">` to the surface colour (`#E6E6E3` / `#1F2023`), so the Android status bar and the browser UI match.
- Tailwind v4: make `dark:` follow the attribute, not only the media query:
  ```css
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
  ```

---

## 3. Colour tokens

Define these as CSS variables on `:root` (light) and `[data-theme=dark]`. Components use the variables only; they never use raw hex values.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface` | `#E6E6E3` | `#1F2023` | The one background for page, panels, controls |
| `--shadow-dark` | `#C4C4C0` | `#141517` | Lower-right shadow of raised items / upper-left of pressed |
| `--shadow-light` | `#FFFFFF` | `#2B2C30` | Upper-left highlight of raised items / lower-right of pressed |
| `--line` | `#CFCFCB` | `#34353A` | Dividers inside menus, spinner track |
| `--text` | `#111111` | `#F2F2F2` | Ink: headings, body, icons, Swiss rules |
| `--muted` | `#4A4A4A` | `#A8A8A8` | Captions, metadata, inactive navigation |
| `--red` | `#D0021B` | `#E5222F` | **Fills:** main button, checkbox, toggle, progress, focus ring, logo |
| `--red-text` | `#B80218` | `#FF5A63` | **Red text and icons** on the surface (active, locked, destructive) |
| `--on-red` | `#FFFFFF` | `#FFFFFF` | Text and icons on red fills |
| `--scrim` | `rgba(17,17,17,.28)` | `rgba(0,0,0,.5)` | Behind dialogs and sheets |

Use `--red` for fills and `--red-text` for red writing; they differ so that both pass contrast.

Approximate contrast ratios:

| Pair | Light | Dark |
|---|---|---|
| Text on surface | 15.6:1 | 14.7:1 |
| Muted on surface | 7.4:1 | 7.3:1 |
| Red text on surface | 5.5:1 | 5.6:1 |
| White on red | 5.8:1 | 4.6:1 |

Photo placeholders, shown while a thumbnail loads, use calm mid-tones: `#9DB8C9 #C9B49D #A3C29D #B9A3C2 #C2A39D #9DC2BB #C2BC9D #A7AFC7 #C7A7B5`.

---

## 4. Depth (the soft shadows)

Every depth is the same formula at a different distance `d`:

```css
/* raised */  box-shadow:  d d 2d var(--shadow-dark),  -d -d 2d var(--shadow-light);
/* pressed */ box-shadow: inset d d 2d var(--shadow-dark), inset -d -d 2d var(--shadow-light);
```

| Utility | d | Used for |
|---|---|---|
| `raised-xs` | 2 | Checkbox, toggle knob, badges |
| `raised-sm` | 3 | Chips, file-type tiles, avatar, phone header buttons |
| `raised` | 4 | Buttons, icon buttons, segmented thumb |
| `raised-md` | 5–6 | Grid cards, toasts, bottom nav, + button |
| `raised-lg` | 8 | Panels: sidebar, file list, transfers card |
| `raised-xl` | 10–12 | The sign-in card (on the page) |
| `lift` | — | **Anything floating above the page** (dialogs, menus, the phone drawer): a glow all round — dark in the light theme, light in the dark theme — plus a 1 px edge. Not the two-sided soft shadow, whose white side looks wrong over the darkened page |
| `pressed-xs` | 2 | Progress tracks, selected menu item, sheet handle |
| `pressed` | 3–4 | Inputs, search, active nav / chip, selected row, storage card |
| `pressed-lg` | 5 | Empty-state well, locked / folder thumbnails |

Main red buttons keep a `raised` shadow, so they sit on the surface like everything else.

**Raised vs pressed: the rule**

- **Raised** = can be pressed: buttons, chips, cards, panels, tiles, menus, dialogs, bottom nav.
- **Pressed** = holds a value or shows "you are here":
  - inputs, search, and the active nav item / chip / segment;
  - the selected list row, progress tracks, the storage card, empty wells;
  - the grid-card thumbnail area for non-photo files.
- **Pressing** a raised button swaps it to `pressed` for 120 ms. Its text goes red for main and destructive buttons, and stays ink for the others.

---

## 5. Typography

**Archivo** (variable, 400–900), bundled with the app via `@fontsource-variable/archivo` so it works offline and makes no third-party requests, with `system-ui, sans-serif` as the fallback. Never use Inter or Roboto.

| Style | Size / weight | Tracking | Use |
|---|---|---|---|
| Display XL | 96 / 900, line 0.9 | −0.055em | Password screen wordmark (desktop) |
| Display | 64 / 900 | −0.05em | Password screen wordmark (phone), element sheet title |
| H1 | 46 / 900 desktop, 40 / 900 phone, line 1 | −0.04em | Page title: "My Drive", folder name, "Recent"… |
| H2 | 20–24 / 900 | −0.02em | Dialog and section titles |
| Title | 15 / 700 | 0 | Item names, menu items (14 / 600) |
| Body | 14–15 / 400–500, line 1.5 | 0 | Paragraphs, dialog text |
| Caption | 12–13 / 400–600 | 0 | Sizes, dates, metadata (colour `--muted`) |
| Label | 11–12 / 800, UPPERCASE | +0.08–0.12em | Section labels, "LOCKED", badges, date headers |

Swiss details:
- **Section labels** have a 2 px `--text` rule above them and a red number: `01 BUTTONS`, `TODAY`.
- **Breadcrumbs** use red slashes: `My Drive / Documents / Taxes`. Parents are `--muted`; the current folder is `--text`.
- **The wordmark** is "Tele / Drive" on two lines, with a red full stop.
- The item count sits next to the H1, baseline-aligned: `My Drive  7 items`.

---

## 6. Shape and spacing

- **Radius:**
  - 6 px for everything: buttons, inputs, chips, cards, panels, menus, dialogs, tiles.
  - 10 px for the phone + button.
  - 16 px for the top corners of the phone sheet.
  - Round for the avatar, toggle and radio.
  - 5 px for the checkbox.
- **Spacing grid:** 4 px steps. Common gaps are 4 (rows), 8–10 (chips), 12–14 (inside rows), 18 (panels, desktop), 56–64 (element-sheet sections).
- **Touch targets:** at least **44 × 44 px** on both desktop and phone.

### Desktop shell (≥ 1024 px)
- 18 px padding around the window, with 18 px gaps between columns.
- **Sidebar** (256 px, `raised-lg` panel):
  - logo + "TeleDrive" + drive name with a chevron (drive switcher);
  - red **New** button;
  - nav items: My Drive, Recent, Starred, Camera backup (app only), Trash, with counts on the right in `--muted`;
  - a storage card at the bottom (`pressed`): space used in large type, files · folders, and a bar of what takes the space (Photos ink, Videos red, Docs muted, Other faint) with sizes underneath.
- **Top bar:** search (pressed, fills the width), List/Grid segmented control, theme icon button, avatar.
- **Header:** H1 + item count, or a breadcrumb inside folders. Filter chips go underneath.
- **Content:** the file list or grid in one `raised-lg` panel. The right column (290 px) shows Transfers when active.

### Tablet (640–1023 px)
- The sidebar becomes a slide-in drawer (the current behaviour), with the same contents.

### Phone (< 640 px)
- **Top:** menu button (raised) on the left; search and avatar (raised) on the right.
- **Then:** H1 (40 px) and the filter chips.
- **Content panel:** 12 px side margin.
- **Bottom nav:** floats 12 px from the edges, 72 px tall, `raised-md`. Tabs: Drive, Recent, Starred, Backup (app). The active tab has a pressed 56 × 32 pill with red icon and label.
- **+ button:** 60 × 60, red, radius 10, `raised-md`, 24 px from the right, 104 px from the bottom (above the nav).

---

## 7. Components

Map each component to its existing file and restyle it; don't create parallel versions.

### Buttons (`btn-*` utilities in `src/index.css`)
| Variant | Look | Use |
|---|---|---|
| Primary | `--red` fill, white 14/700, `raised` | One per view: New, Upload, Lock folder, Unlock drive |
| Secondary | Surface, `raised`, ink text | New folder, Download, Cancel in toolbars |
| Ghost | No fill or shadow, ink text | Cancel in dialogs, Log out |
| Danger | Surface, `raised`, `--red-text` text + icon | Move to trash, Remove lock |
| Danger solid | `--red` fill, white | Final destructive confirm only: Delete forever, Empty trash |

- Height 44, padding 0 18, gap 8, icon 17 px with stroke 2.
- **Pressed:** swap to `pressed`.
- **Disabled:** 45% opacity, no shadow change, `cursor: not-allowed`.
- **Icon button** (`icon-btn`): 44 × 44, `raised`, 19 px icon. Active or toggled = `pressed` with a red icon.

### Inputs (`input`)
- Height 46, padding 0 14, `pressed`, 14 px text. The placeholder is `--muted`.
- An optional leading icon (17 px, muted) and trailing icon (show/hide password, info).
- The label sits above: 13/700, 8 px gap.
- **Focus:** `outline: 2px solid var(--red); outline-offset: 2px`. Never remove focus styles.
- **Error:** the same red outline, plus a 12 px `--red-text` message below ("Wrong password").
- **Hint:** 12 px `--muted` below ("At least 8 characters").

### Selection
- **Checkbox:** 24 × 24, radius 5. Off = `pressed-xs`. On = `--red` fill + `raised-xs` + a white check (stroke 3).
- **Toggle:** 54 × 30 round track; the knob is a 22 px surface circle with `raised-xs`. Off = `pressed`. On = red track with a darker inset; the knob moves right.
- **Radio:** 24 px `pressed-xs` circle; selected adds a 10 px red dot.
- **Segmented control** (List / Grid): a `pressed` track with 4 px padding. The active segment is `raised-sm` with red 13/800 text and icon; inactive segments are `--muted` 13/600.

### Filter chips (`chip`, `chip-active`)
- Padding 9 × 15, 13 px. Inactive = `raised-sm`, 13/600 ink. Active = `pressed`, `--red-text`, 13/800.
- The "Locked" chip has a 14 px lock icon.

### Navigation items (Sidebar `Link`)
- Height 42, padding 0 14, gap 12, 19 px icon. Inactive = `--muted` 14/600.
- Active = `pressed`, `--red-text`, 14/800.
- Counts sit on the right, 12 px, muted.

### File list row (`FileView` list)
- Padding 10 × 12, gap 14.
- **File-type tile:** 44 × 44, `raised-sm`, 21 px ink icon. Locked items get a red lock icon instead.
- **Name:** 15/700, with any markers inline:
  - a red star (14 px) when starred;
  - a red `LOCKED` label (11/800, +0.08em) when locked.
- **Details:** 13 px muted: size, or "Protected with its own password", or "1.4 GB · 3 Telegram messages".
- **Date:** 12 px muted, on the right.
- **Selected:** the whole row is `pressed`.
- **Uploading:** a 6 px progress bar under the details.
- Don't put a shadow on each row. Only the tile is raised, which keeps long lists cheap.

### Grid card (`FileView` grid)
- 8 px padding, `raised-md`.
- **Thumbnail:** 120 px tall, radius 6.
  - Photos and videos show the image.
  - Other files show a `pressed` well with a 34 px ink icon.
  - Locked items show a `pressed` well with a red lock.
- **Name:** 14/700 below, one line with an ellipsis. Details: 12 px muted.
- **Selected:** `outline: 2px solid var(--red); outline-offset: 3px`.

### Menu (`Menu.tsx`)
- 240–250 px wide, 8 px padding, `lift`.
- Items: 40 px tall, 17 px icon, 14/600. Hover or keyboard focus = `pressed-xs`.
- A 2 px `--line` divider sits before destructive items. "Move to trash" is `--red-text` 14/700.
- On the phone, the same actions open in the **bottom sheet** instead.

### Dialog (`Dialog.tsx` and all of `dialogs/`)
- Centred, max-width 440–520, padding 26, gap 18, `lift`, over `--scrim`.
- **Header:** an optional 40 px tile (red lock for lock actions), the H2 title, and a 13 px muted subtitle.
- **Footer:** actions on the right, gap 12. The ghost Cancel comes first, then the primary or danger-solid button.
- Dialogs that need the TeleDrive password show it as the first field, with a shield icon.

### Bottom sheet (phone actions, phone dialogs)
- Full width, top radius 16, surface colour, plus a `0 -10px 30px rgba(0,0,0,.18)` lift.
- A 40 × 5 `pressed` handle.
- **Header:** tile + name + details, with a 2 px ink rule under it (Swiss).
- Items: 48 px tall, 20 px icon, 15/600, left-aligned. Destructive items are last, in red.

### Toast (`Toasts.tsx`)
- Padding 12 × 16, `raised-md`, 14/600, with a leading icon:
  - upload = ink;
  - success = ink check;
  - error = red ✕.
- An optional action on the right, 13/800 red ("Undo").
- Desktop: bottom-right. Phone: above the bottom nav.

### Transfers card (`TransferPanel.tsx`)
- `raised-lg` panel. Header "Transfers" (15/900), with "2 active" muted on the right.
- **Each transfer:** name 14/700 with the % or status ("Checking file…") right-aligned, then speed and size (12 px muted), then the progress bar.
- **Progress bar:** 8 px `pressed-xs` track with a `--red` fill (radius 6).

### Badges
- 11/800 uppercase, +0.08em, padding 4 × 9, radius 6.
- Kinds:
  - neutral, `raised-xs`: ENCRYPTED;
  - outline, 1.5 px red: LOCKED;
  - solid red: `OPEN · 4:12` auto-lock countdown, counts.

### Tooltip
- An ink background (`--text`) with surface-coloured text, 13/700, padding 8 × 12, radius 6. No shadow.

### Spinner
- 28 px circle, 3 px `--line` border, with the top border in `--red`, rotating at 0.8 s per turn.

### Empty state
- A `pressed-lg` well, padding 44 × 28, centred.
- Inside: a 72 px raised tile with a 32 px muted icon; "Nothing here yet" (22/900); one muted line; a primary button.

### Logo
- **The mark:** a white paper plane on a red square (concept 01 in [`design/5-logos/`](design/5-logos/); the other concepts are kept there and in [`design/6-logos-original/`](design/6-logos-original/) for reference).
- In the app: `components/Logo.tsx`, the same drawing as the icons, with `raised-sm`. 40 px in the sidebar, 52 px on the sign-in screens (steps with their own icon, such as the TeleDrive password, show that icon instead).
- Icons: `public/favicon.svg`, the PWA PNGs (`icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon`), and the Android launcher (adaptive icon on `#D0021B`, legacy PNGs per density) and splash screen.

### Avatar
- 44 px, `raised-sm`, with the initial in 900 weight.

### Preview (`Preview.tsx`)
- The media viewer **stays black in both themes**, because photos and videos need a neutral dark background.
- Restyle only its controls: white icons, 44 px buttons and the Archivo font.

---

## 8. Screens

| Screen | Layout notes |
|---|---|
| **Drive** (list) | Desktop shell. H1 "My Drive" + count. Chips: All / Photos / Videos / Documents / Locked. Rows in one panel. Transfers in the right column while active. Right-click or the ⋯ button opens the menu. |
| **Folder** | Like Drive, with a breadcrumb (red slashes) instead of the item count. The H1 is the folder name. |
| **Grid view** | Five columns on desktop, three on tablet, two on phone, all with 18 px gaps. Cards as in §7. |
| **Recent / Starred / Trash** | Same shell, with H1 = page name. Trash puts the "Empty trash" (danger solid) button next to the H1. |
| **Lock / unlock / change password** | Dialog with the red lock tile. Lock needs the TeleDrive password and then the item password. Unlock needs only the item password. |
| **Delete forever / Empty trash** | Dialog. Asks for the TeleDrive password when locked items are included. Confirm = danger solid. |
| **Login / Setup / TeleDrive password** | Split screen on desktop: wordmark and tagline on the left with a 3 px rule, and a `raised-xl` card on the right. On the phone, the wordmark sits on top with the card underneath. One red primary action, with "Log out" as ghost. |
| **Camera backup** (app) | Phone: H1 "Camera". A backup progress card (red refresh icon + progress bar), then an uppercase date label with the rule ("TODAY"), then a three-column photo grid with 6 px gaps and radius 6. |
| **Details** | Dialog with label/value rows: 13 px muted label, value in ink. The "Protection" row says Locked in `--red-text`. |

---

## 9. Icons

- **lucide-react**, stroke 1.8. Use stroke 2–2.2 on red fills and active states.
- Sizes:
  - 17 px in buttons and inputs;
  - 19–20 px in nav, rows and the phone;
  - 21 px in file tiles;
  - 34 px in card wells.
- Always `currentColor`, so icons follow the text colour of their state.
- Icon-only buttons need an `aria-label`.

---

## 10. Motion

- Press: swap the shadow in 120 ms ease-out.
- Hover: on desktop only, raised items lighten their highlight slightly; nothing moves.
- The menu and dialogs fade and scale from 0.98 in 150 ms. The phone sheet slides up in 200 ms.
- Theme switch: change instantly, with no colour animation, so there are no half-themed frames.
- `prefers-reduced-motion: reduce` turns all of these off.

---

## 11. Implementation plan (Phase 7)

1. **Tokens and utilities** in `src/index.css`:
   - colour variables for light and dark;
   - the `dark` custom variant on `data-theme`;
   - `raised-*` / `pressed-*` utilities;
   - rewrite `btn`, `btn-primary`, `btn-ghost`, `btn-danger`, `icon-btn`, `input`, `card`, `chip`, `chip-active` to the spec above;
   - add `btn-secondary`, `btn-danger-solid`, `label-swiss` and `progress`;
   - replace the current `slate-*` and `brand` colours with tokens.
2. **Font:** Archivo in `index.html` and `backup.html`, and `--font-sans` in `@theme`.
3. **Theme store:** System / Light / Dark saved on the device; the early inline script; the `theme-color` meta tag; the toggle button in the top bar.
4. **Shell:**
   - Sidebar: panel, New button, nav, storage card, drive switcher.
   - Top bar: search, segmented control, theme button.
   - H1 + chips.
   - Phone: bottom nav and the + button.
5. **Content:** `FileView` list rows and grid cards, empty states, breadcrumb.
6. **Overlays:** Menu, Dialog (and every dialog in `components/dialogs/`), the phone bottom sheet for item actions, Toasts, TransferPanel.
7. **Auth pages:** Login, Setup, Password (split layout and wordmark).
8. **Preview:** restyle the controls only.
9. **Checks:**
   - typecheck and unit tests;
   - browser screenshots of each screen in light and dark, at desktop (1280) and phone (390) widths;
   - compare against `design/1-final-theme/`.

Not changing in Phase 7: how anything works. This phase is visual only; the features, data and flows stay as they are.

---

## 12. Open choices

- **Red for main and danger:** right now red is both the brand colour (New, Upload) and the destructive colour. They're kept apart by style: "Move to trash" is a grey button with red text, and only the final "Delete forever" confirm is solid red. The other option is black main buttons, so that red means only "danger". Decide before implementing step 1.
