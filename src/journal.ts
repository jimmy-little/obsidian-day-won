import { TFile, TFolder, Vault, MetadataCache } from "obsidian";

/** A single journal entry: one note with resolved date and optional first image. */
export interface JournalEntry {
  file: TFile;
  date: string; // YYYY-MM-DD
  time: string; // optional, for ordering (e.g. "21:20")
  /** Display name in list (from entry property or first line / file name) */
  name: string;
  /** First line of body or file name for preview / fallback */
  preview: string;
  /** Section label from journal property (e.g. Life, Stats, Daily) */
  journal: string;
  /** Vault-relative path to first image in the note, or null */
  firstImagePath: string | null;
  /** Frontmatter cover/image path when present; use as card header (not tiled). */
  coverImagePath: string | null;
  /** All image paths from the note (body + frontmatter) for tiling in day view. */
  imagePaths: string[];
  /** User-defined entry type name when rules match (order = priority). */
  entryType: string | null;
  /** True when frontmatter has the time-tracking key set with a non-empty value (see settings). */
  hasLapseEntries: boolean;
  /** True when entry is classified as media (season/episode, show/embed, tags, etc.). */
  isMedia: boolean;
  /** For media: show/series title from frontmatter (show_title). */
  showTitle: string | null;
  /** For media: season number or label from frontmatter (season). */
  season: string | number | null;
  /** For media: episode number or label from frontmatter (episode). */
  episode: string | number | null;
}

/** Rule shape for one entry type (name + mode + value). Order in array = priority. */
export interface EntryTypeRuleShape {
  name: string;
  mode: "" | "path" | "frontmatter";
  value: string;
}

/** Group entries by date (YYYY-MM-DD). Multiple entries per day are in the same key. */
export function groupEntriesByDate(entries: JournalEntry[]): Map<string, JournalEntry[]> {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  // Sort each day's entries by time if present
  for (const list of map.values()) {
    list.sort((a, b) => (a.time || "00:00").localeCompare(b.time || "00:00"));
  }
  return map;
}

/** Group entries by month (YYYY-MM) for list view. */
export function groupEntriesByMonth(entries: JournalEntry[]): Map<string, JournalEntry[]> {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    const list = map.get(month) ?? [];
    list.push(e);
    map.set(month, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      return d !== 0 ? d : (a.time || "00:00").localeCompare(b.time || "00:00");
    });
  }
  return map;
}

/** Group entries by journal (section) for list view. Returns map of journal name → entries (newest first). */
export function groupEntriesByJournal(entries: JournalEntry[]): Map<string, JournalEntry[]> {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const key = e.journal || "Default";
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const d = b.date.localeCompare(a.date); // newest first
      return d !== 0 ? d : (b.time || "00:00").localeCompare(a.time || "00:00");
    });
  }
  return map;
}

const IMAGE_MD_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/;
const IMAGE_WIKILINK_REGEX = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
]);

/** Return path only if it points to an actual image file (filters out note embeds like ![[Note]]). */
function resolveToImagePath(
  vault: Vault,
  metadataCache: MetadataCache,
  sourceFilePath: string,
  extractedPath: string
): string | null {
  const ext = extractedPath.includes(".")
    ? "." + extractedPath.split(".").pop()!.toLowerCase()
    : "";
  if (IMAGE_EXTENSIONS.has(ext)) {
    const file = vault.getAbstractFileByPath(extractedPath);
    if (file instanceof TFile) return file.path;
  }
  const resolved = metadataCache.getFirstLinkpathDest(extractedPath, sourceFilePath);
  if (resolved instanceof TFile && IMAGE_EXTENSIONS.has("." + resolved.extension.toLowerCase())) {
    return resolved.path;
  }
  return null;
}

function getFirstImageFromContent(content: string, file: TFile): string | null {
  const dir = (file.parent && file.parent.path) ? file.parent.path + "/" : "";

  const tryMd = content.match(IMAGE_MD_REGEX);
  if (tryMd) {
    const src = tryMd[2].trim();
    if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("app://")) {
      return dir ? resolveRelativePath(dir, src) : src;
    }
  }

  const wikilink = IMAGE_WIKILINK_REGEX.exec(content);
  IMAGE_WIKILINK_REGEX.lastIndex = 0;
  if (wikilink) {
    const raw = wikilink[1].trim();
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return null;
    return raw;
  }
  return null;
}

/** Collect all image paths from note content (markdown and wikilinks). */
function getAllImagePathsFromContent(content: string, file: TFile): string[] {
  const dir = (file.parent && file.parent.path) ? file.parent.path + "/" : "";
  const out: string[] = [];
  const seen = new Set<string>();

  const mdMatches = content.matchAll(new RegExp(IMAGE_MD_REGEX.source, "g"));
  for (const m of mdMatches) {
    const src = m[2].trim();
    if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("app://")) {
      const resolved = dir ? resolveRelativePath(dir, src) : src;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(resolved);
      }
    }
  }

  IMAGE_WIKILINK_REGEX.lastIndex = 0;
  let w;
  while ((w = IMAGE_WIKILINK_REGEX.exec(content)) !== null) {
    const raw = w[1].trim();
    if (raw && !raw.startsWith("http://") && !raw.startsWith("https://") && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  IMAGE_WIKILINK_REGEX.lastIndex = 0;
  return out;
}

const WIKILINK_IN_FM_REGEX = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/;

/** Strip wikilink syntax and leading underscore for display: "[[_Home]]" -> "Home". */
function stripWikilinkDisplay(s: string): string {
  if (!s || typeof s !== "string") return s;
  let t = s.trim();
  const m = t.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (m) t = m[1].trim();
  else t = t.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1").trim();
  return t.replace(/^_+/, "").trim() || s;
}

const MEDIA_TYPES = new Set(["movie", "tvshow", "tv show", "podcast", "book", "youtube"]);

function normalizeForMediaMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function classifyAsMedia(front: Record<string, unknown> | undefined, content: string): boolean {
  if (!front && !content) return false;
  if (front) {
    if (front.season != null || front.episode != null) return true;
    if (typeof front.episode_title === "string" && front.episode_title.trim()) return true;
    if (typeof front.show_title === "string" && front.show_title.trim()) return true;
    for (const key of Object.keys(front)) {
      const v = front[key];
      if (typeof v === "string" && v.includes("youtube")) return true;
    }
    const g = front.globalType ?? front.global_type;
    const gStr = typeof g === "string" ? normalizeForMediaMatch(g) : "";
    if (gStr && MEDIA_TYPES.has(gStr)) return true;
    const tags = front.tags;
    if (Array.isArray(tags)) {
      for (const t of tags) {
        const n = typeof t === "string" ? normalizeForMediaMatch(t.replace(/^#/, "")) : "";
        if (n && MEDIA_TYPES.has(n)) return true;
      }
    }
  }
  if (content && /youtube\.com\/embed|youtube\.com\/watch|youtu\.be\//i.test(content)) return true;
  return false;
}

/** Display name fallback chain: entry (front or inline) → title → name → project → preview (filename). */
function resolveDisplayName(
  front: Record<string, unknown> | undefined,
  entryName: string,
  inlineEntry: string | null,
  preview: string
): string {
  const fromEntry = (entryName || inlineEntry || "").trim();
  if (fromEntry) return stripWikilinkDisplay(fromEntry);
  const fromTitle = typeof front?.title === "string" ? front.title.trim() : "";
  if (fromTitle) return stripWikilinkDisplay(fromTitle);
  const fromName = typeof front?.name === "string" ? front.name.trim() : "";
  if (fromName) return stripWikilinkDisplay(fromName);
  const fromProject = typeof front?.project === "string" ? front.project.trim() : "";
  if (fromProject) return stripWikilinkDisplay(fromProject);
  return stripWikilinkDisplay(preview);
}

/** Normalize time for display: extract HH:MM from ISO, "YYYY-MM-DD HH:MM", or pass through. */
function normalizeTimeForDisplay(raw: string): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return t;
  const iso = t.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}(?::\d{2})?)/);
  if (iso) return iso[1].slice(0, 5);
  const dateSpace = t.match(/^\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (dateSpace) return dateSpace[1].slice(0, 5);
  return t;
}

/** Parse first inline field in content, e.g. "entry:: value" (key is case-sensitive). */
function getInlineFieldValue(content: string, fieldKey: string): string | null {
  const escaped = fieldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}::\\s*(.+)$`, "m");
  const match = content.match(re);
  if (!match) return null;
  return match[1].trim() || null;
}

/** Remove YAML frontmatter block (between first --- and second ---). */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const second = content.indexOf("\n---", 4);
  if (second === -1) return content;
  return content.slice(second + 4).trimStart();
}

/** Remove fenced code blocks (e.g. ```dataview, ```js, ```) so preview uses prose only. */
function stripCodeBlocks(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^```[\w]*\s*$/.test(line)) {
      inBlock = !inBlock;
      continue;
    }
    if (!inBlock) out.push(line);
  }
  return out.join("\n");
}

/** Clean a line for preview: show value not field name for inline fields; strip blockquote/callout syntax. */
function previewLine(line: string): string {
  let s = line.trim();
  // Blockquote / callout: "> [!note] text" or "> text"
  s = s.replace(/^\s*>\s*/, "");
  s = s.replace(/^\[![\w-]+\]\s*/, "");
  // Inline field: "entry:: value" -> "value"
  const inlineMatch = s.match(/^\w+::\s*(.*)$/);
  if (inlineMatch) s = inlineMatch[1].trim();
  return s;
}

const FRONTMATTER_IMAGE_KEYS = ["cover", "image", "image_url", "banner", "photo", "thumbnail"];

function getFrontmatterImagePath(front: Record<string, unknown> | undefined, file: TFile): string | null {
  if (!front) return null;
  for (const k of FRONTMATTER_IMAGE_KEYS) {
    const v = front[k];
    if (typeof v !== "string" || !v.trim()) continue;
    let src = v.trim();
    const wikilinkMatch = src.match(WIKILINK_IN_FM_REGEX);
    if (wikilinkMatch) src = wikilinkMatch[1].trim();
    if (!src) continue;
    const isUrl = src.startsWith("http://") || src.startsWith("https://");
    if (isUrl && k !== "image_url") continue;
    if (isUrl) return src;
    const dir = (file.parent && file.parent.path) ? file.parent.path + "/" : "";
    return src.includes("/") ? src : (dir ? resolveRelativePath(dir, src) : src);
  }
  return null;
}

function resolveRelativePath(dir: string, relative: string): string {
  const parts = (dir + "/" + relative).split("/").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

/** Collect all markdown files under folder (or vault root if folder empty). */
function getMarkdownFilesInFolder(vault: Vault, folderPath: string): TFile[] {
  const out: TFile[] = [];
  const normalized = folderPath.replace(/^\//, "").replace(/\/$/, "").trim();

  function walk(obj: TFile | TFolder | null) {
    if (!obj) return;
    if (obj instanceof TFile) {
      if (obj.extension === "md") out.push(obj);
      return;
    }
    if (obj instanceof TFolder) {
      for (const c of obj.children) walk(c as TFile | TFolder);
    }
  }

  if (normalized) {
    const node = vault.getAbstractFileByPath(normalized);
    walk(node as TFolder | TFile | null);
  } else {
    for (const f of vault.getMarkdownFiles()) out.push(f);
  }
  return out;
}

/** Parse "Journal folders" setting: newline or comma separated, trimmed, non-empty. */
export function parseFolderList(input: string): string[] {
  if (!input || !input.trim()) return [];
  const parts = input.split(/[\n,]+/).map((p) => p.replace(/^\//, "").replace(/\/$/, "").trim());
  return parts.filter((p) => p.length > 0);
}

/** Default header background color for a journal name (used when no config is set). */
export function getDefaultJournalColor(journalName: string): string {
  const palette: Record<string, string> = {
    Life: "#f5c842",
    Daily: "#4caf50",
    Stats: "#2196f3",
    Default: "#78909c",
  };
  if (palette[journalName]) return palette[journalName];
  let h = 0;
  for (let i = 0; i < journalName.length; i++) h = (h << 5) - h + journalName.charCodeAt(i);
  h = Math.abs(h) % 360;
  return `hsl(${h}, 55%, 52%)`;
}

/** Discover unique journal names from folders (notes with date in frontmatter). Sync, no file reads. */
export function getJournalNamesFromFolders(
  vault: Vault,
  metadataCache: MetadataCache,
  folderList: string[],
  dateProperty: string,
  journalProperty: string
): string[] {
  const files = getMarkdownFilesInFolders(vault, folderList);
  const set = new Set<string>();
  for (const file of files) {
    const cache = metadataCache.getFileCache(file);
    const front = cache?.frontmatter;
    const rawDate = front?.[dateProperty];
    if (rawDate == null) continue;
    if (parseDate(rawDate) == null) continue;
    const journal = (front?.[journalProperty] ?? "") as string;
    const name = typeof journal === "string" ? journal.trim() : "";
    set.add(name || "Default");
  }
  return [...set].sort((a, b) => (a === "Default" ? 1 : a.localeCompare(b)));
}

/** Collect markdown files from multiple folders (deduped by path). Empty folderList = whole vault. */
function getMarkdownFilesInFolders(vault: Vault, folderList: string[]): TFile[] {
  const seen = new Set<string>();
  const out: TFile[] = [];
  if (folderList.length === 0) {
    for (const f of vault.getMarkdownFiles()) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        out.push(f);
      }
    }
    return out;
  }
  for (const folderPath of folderList) {
    for (const f of getMarkdownFilesInFolder(vault, folderPath)) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        out.push(f);
      }
    }
  }
  return out;
}

/** Parse comma-separated "key: value" frontmatter conditions. Values may be quoted. */
function parseFrontmatterConditions(value: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim();
    let val = part.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    out.push({ key, value: val });
  }
  return out;
}

/** Check if note frontmatter matches all given key:value conditions. */
function frontmatterMatches(front: Record<string, unknown> | undefined, conditions: { key: string; value: string }[]): boolean {
  if (!front || conditions.length === 0) return false;
  for (const { key, value } of conditions) {
    const v = front[key];
    const str = v != null ? String(v).trim() : "";
    if (str !== value) return false;
  }
  return true;
}

/** Expand date placeholders in a folder path. dateKey = "YYYY-MM-DD". Supports {YYYY}, {MM}, {DD}, {YYYY/MM}, {YYYY-MM}, {MM/DD}. */
function expandPathTemplate(template: string, dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  if (parts.length < 3) return template;
  const [y, m, d] = parts;
  const YYYY = String(y);
  const MM = String(m).padStart(2, "0");
  const DD = String(d).padStart(2, "0");
  return template
    .replace(/\{YYYY\/MM\}/g, `${YYYY}/${MM}`)
    .replace(/\{YYYY-MM\}/g, `${YYYY}-${MM}`)
    .replace(/\{MM\/DD\}/g, `${MM}/${DD}`)
    .replace(/\{YYYY\}/g, YYYY)
    .replace(/\{MM\}/g, MM)
    .replace(/\{DD\}/g, DD);
}

/** Check if file path is under any of the given folder paths (vault-relative, no leading slash). */
function pathUnderFolders(filePath: string, folderList: string[]): boolean {
  const normalized = filePath.replace(/^\/+/, "");
  for (const folder of folderList) {
    const f = folder.replace(/^\/+/, "").replace(/\/+$/, "");
    if (f === "" || normalized === f || normalized.startsWith(f + "/")) return true;
  }
  return false;
}

/** Classify a note by ordered entry types: first match wins. dateKey = note date "YYYY-MM-DD". */
function classifyEntryType(
  filePath: string,
  front: Record<string, unknown> | undefined,
  entryTypes: EntryTypeRuleShape[],
  dateKey: string
): string | null {
  if (!entryTypes?.length) return null;
  // 1) Frontmatter: check each type in order
  for (const t of entryTypes) {
    if (t.mode !== "frontmatter" || !t.value.trim()) continue;
    const conditions = parseFrontmatterConditions(t.value);
    if (frontmatterMatches(front, conditions)) return t.name;
  }
  // 2) Path: first matching path rule (expand date vars with note date)
  for (const t of entryTypes) {
    if (t.mode !== "path" || !t.value.trim()) continue;
    const rawPaths = t.value.split(",").map((s) => s.trim()).filter(Boolean);
    const paths = rawPaths.map((p) => expandPathTemplate(p, dateKey));
    if (pathUnderFolders(filePath, paths)) return t.name;
  }
  return null;
}

/** Build journal entries from vault: scan folder(s), read frontmatter and first image. */
export async function getJournalEntries(
  vault: Vault,
  metadataCache: MetadataCache,
  folderList: string[],
  dateProperty: string,
  timeProperty: string,
  entryProperty: string,
  journalProperty: string,
  entryTypes?: EntryTypeRuleShape[],
  lapseEntriesProperty?: string
): Promise<JournalEntry[]> {
  const types = entryTypes ?? [];
  const lapseKey = (lapseEntriesProperty ?? "lapseEntries").trim() || null;

  const files = getMarkdownFilesInFolders(vault, folderList);
  const candidates: { file: TFile; date: string; timeStr: string; journal: string; entryName: string }[] = [];

  for (const file of files) {
    const cache = metadataCache.getFileCache(file);
    const front = cache?.frontmatter;
    const rawDate = front?.[dateProperty];
    if (rawDate == null) continue;
    const date = parseDate(rawDate);
    if (!date) continue;
    const timeRaw =
      (front?.[timeProperty] ?? front?.startTime ?? "") as string;
    const timeStr = normalizeTimeForDisplay(typeof timeRaw === "string" ? timeRaw : "");
    const journal = (front?.[journalProperty] ?? "") as string;
    const journalStr = typeof journal === "string" ? journal.trim() : "";
    const entryVal = front?.[entryProperty];
    const entryName = typeof entryVal === "string" ? stripWikilinkDisplay(entryVal.trim()) : "";
    candidates.push({ file, date, timeStr, journal: journalStr, entryName });
  }

  const entries: JournalEntry[] = [];
  for (const { file, date, timeStr, journal, entryName } of candidates) {
    let firstImagePath: string | null = null;
    const cache = metadataCache.getFileCache(file);
    const front = cache?.frontmatter;
    const frontImgRaw = getFrontmatterImagePath(front, file);
    const isExternalUrl =
      typeof frontImgRaw === "string" &&
      (frontImgRaw.startsWith("http://") || frontImgRaw.startsWith("https://"));
    const frontImg = isExternalUrl
      ? frontImgRaw
      : frontImgRaw
        ? resolveToImagePath(vault, metadataCache, file.path, frontImgRaw)
        : null;
    if (frontImg) firstImagePath = frontImg;
    const entryType = classifyEntryType(file.path, front, types, date);
    let preview = file.basename;
    let name = resolveDisplayName(front, entryName, null, preview);
    let imagePaths: string[] = [];
    let isMedia = classifyAsMedia(front, "");
    try {
      const content = await vault.cachedRead(file);
      isMedia = classifyAsMedia(front, content);
      if (!firstImagePath) {
        const contentImg = getFirstImageFromContent(content, file);
        if (contentImg) {
          const resolved = resolveToImagePath(vault, metadataCache, file.path, contentImg);
          if (resolved) firstImagePath = resolved;
        }
      }
      let fromContent = getAllImagePathsFromContent(content, file);
      fromContent = fromContent
        .map((p) => resolveToImagePath(vault, metadataCache, file.path, p))
        .filter((p): p is string => p != null);
      if (frontImg) imagePaths = [frontImg, ...fromContent.filter((p) => p !== frontImg)];
      else imagePaths = fromContent;
      const body = stripCodeBlocks(stripFrontmatter(content));
      const contentLines = body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---"));
      const previewLines = contentLines.map(previewLine).filter((l) => l.length > 0);
      const firstTwo = previewLines.slice(0, 2).join(" ").trim();
      if (firstTwo) preview = firstTwo.slice(0, 180);
      const inlineEntry = entryProperty ? getInlineFieldValue(content, entryProperty) : null;
      name = resolveDisplayName(front, entryName, inlineEntry, preview);
    } catch {
      // ignore read errors
    }
    if (firstImagePath && imagePaths.length === 0) imagePaths = [firstImagePath];
    const lapse = lapseKey && front ? front[lapseKey] : undefined;
    const hasLapseEntries =
      lapseKey != null &&
      lapse != null &&
      (Array.isArray(lapse) ? lapse.length > 0 : typeof lapse === "object" ? Object.keys(lapse).length > 0 : Boolean(lapse));
    const showTitleRaw = front?.show_title ?? front?.showTitle;
    const showTitle =
      typeof showTitleRaw === "string" && showTitleRaw.trim()
        ? stripWikilinkDisplay(showTitleRaw.trim())
        : null;
    const seasonRaw = front?.season;
    const season =
      seasonRaw != null && (typeof seasonRaw === "number" || typeof seasonRaw === "string")
        ? seasonRaw
        : null;
    const episodeRaw = front?.episode;
    const episode =
      episodeRaw != null && (typeof episodeRaw === "number" || typeof episodeRaw === "string")
        ? episodeRaw
        : null;
    entries.push({
      file,
      date,
      time: timeStr,
      name,
      preview,
      journal,
      firstImagePath,
      coverImagePath: frontImg || null,
      imagePaths,
      entryType,
      hasLapseEntries,
      isMedia,
      showTitle,
      season,
      episode,
    });
  }

  entries.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : (a.time || "00:00").localeCompare(b.time || "00:00");
  });
  return entries;
}

function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  const dateOnlyMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnlyMatch) {
    const y = parseInt(dateOnlyMatch[1], 10);
    const m = parseInt(dateOnlyMatch[2], 10) - 1;
    const d = parseInt(dateOnlyMatch[3], 10);
    const local = new Date(y, m, d);
    if (Number.isNaN(local.getTime())) return null;
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Streak: consecutive days with at least one entry, counting backward from today (or last entry). */
export function computeStreak(entries: JournalEntry[]): number {
  const dates = [...new Set(entries.map((e) => e.date))].sort();
  if (dates.length === 0) return 0;
  const today = new Date();
  const todayStr = formatDateKey(today);
  let count = 0;
  let check = todayStr;
  const set = new Set(dates);
  while (set.has(check)) {
    count++;
    const next = new Date(check);
    next.setDate(next.getDate() - 1);
    check = formatDateKey(next);
  }
  // If we didn't start from today, streak might be 0 (e.g. no entry today)
  if (count === 0 && dates[dates.length - 1] !== todayStr) return 0;
  return count;
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Entries that fall on the same month-day (e.g. "on this day"), reverse chronological (newest first). */
export function getOnThisDayEntries(
  entries: JournalEntry[],
  month: number,
  day: number
): JournalEntry[] {
  return entries
    .filter((e) => {
      const [_, m, d] = e.date.split("-").map(Number);
      return m === month && d === day;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Number of entries that fall on the same month-day in other years (e.g. "on this day"). */
export function onThisDayCount(entries: JournalEntry[], month: number, day: number): number {
  return getOnThisDayEntries(entries, month, day).length;
}
