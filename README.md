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

### Repo

- **Git:** https://github.com/jimmy-little/obsidian-day-won.git

## License

MIT
