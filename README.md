# Day Won

A **Day One–style journal** inside Obsidian: point it at a folder of notes and browse by **list**, **calendar**, or **summary**. Mobile-friendly and dark-mode aware.

## Features

- **Folder of notes** — In settings, choose a vault folder. Each note with a `date` (and optional `time`) in frontmatter becomes a journal entry.
- **Views** — **Summary** (streak, entry count, days, “on this day”), **List** (grouped by month/day), **Calendar** (month grid).
- **First image as calendar background** — The first image in a note is used as that day’s calendar thumbnail when you have entries on that date.
- **Multiple notes per day** — All notes with the same date appear together; opening a calendar day shows every entry for that day; clicking one opens the note.
- **Mobile and dark mode** — Layout and colors work on small screens and follow Obsidian’s light/dark theme.

*Later: a simple iOS app using Apple Journal Suggestions to create these notes.*

## Development

### Prerequisites

- Node.js 18+
- Obsidian with a local vault

### Local vault

This project is set up to use the vault at:

```
/Users/jimmy/Library/Mobile Documents/iCloud~md~obsidian/Documents/JimmyOS
```

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Link the plugin to your vault** (so Obsidian loads it from this repo)

   ```bash
   npm run link-vault
   ```

   This creates a symlink from  
   `JimmyOS/.obsidian/plugins/day-won` → this project folder.

3. **Build in watch mode**

   ```bash
   npm run dev
   ```

   Leave this running; it rebuilds `main.js` when you change `src/**/*.ts`.

4. **In Obsidian**

   - Open the vault **JimmyOS**.
   - Go to **Settings → Community plugins** and enable **Day Won**.

### Scripts

| Command              | Description                          |
|----------------------|--------------------------------------|
| `npm run dev`        | Build and watch (development)        |
| `npm run build`      | Single production build              |
| `npm run build-install` | Build and link into vault (deploy) |
| `./build-install.sh` | Same as `npm run build-install`      |
| `npm run link-vault` | Symlink plugin into vault only       |
| `npm run lint`       | Run ESLint (if configured)           |

### Installing via BRAT (beta testers)

BRAT installs from **GitHub Releases**; the release must include `main.js`, `manifest.json`, `styles.css`, `versions.json`. (Run `npm run release` to create one.)

1. In BRAT, add this repo: `jimmy-little/obsidian-day-won`.
2. **Pick a version from the list** (e.g. `0.0.1`) — don’t use the dev branch. The repo doesn’t include built `main.js`; only releases do.
3. After it installs, go to **Settings → Community plugins** and **turn on “Day, Won!”** (BRAT doesn’t enable it for you).
4. If install still fails (especially on mobile), check GitHub → Releases: the version you picked must have **Assets** with `main.js` attached. If not, run `npm run release` from this repo to create a proper release, then in BRAT use **Check for updates** or re-add the repo and pick the new version. Fully quit and reopen Obsidian. Release tags must match the version (e.g. `0.0.2`, not `v0.0.2`).
5. **BRAT finds versions but install runs then fails:** BRAT may be using GitHub’s “Source code (zip)”, which does not contain the built `main.js`. Add a plugin zip to the release: run `node upload-plugin-zip-to-release.mjs 0.0.3` (use the version you’re testing), then try BRAT again. If it still fails, consider opening an issue on [obsidian42-brat](https://github.com/TfTHacker/obsidian42-brat) with your repo and release link.

### Repo

- **Git:** https://github.com/jimmy-little/obsidian-day-won.git

## License

MIT
