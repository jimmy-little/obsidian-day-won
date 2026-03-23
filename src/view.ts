import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  Modal,
  setIcon,
  App,
  getAllTags,
  MarkdownRenderer,
} from "obsidian";
import type DayWonPlugin from "./main";

/** Must match PLUGIN_ICON in main.ts (open book). */
const VIEW_ICON = "book-open";
import {
  type JournalEntry,
  type EntryTypeRuleShape,
  getJournalEntries,
  getOnThisDayEntries,
  groupEntriesByDate,
  groupEntriesByJournal,
  computeStreak,
  onThisDayCount,
  parseFolderList,
  getDefaultJournalColor,
} from "./journal";
import type { UserEntryType } from "./settings";

function entryTypesToRuleShape(list: UserEntryType[] | undefined): EntryTypeRuleShape[] {
  if (!list?.length) return [];
  return list.map((t) => ({ name: t.name, mode: t.mode, value: t.value }));
}

/** Format a path template with moment-style date variables. */
function formatPathWithDate(template: string, date: Date): string {
  const YYYY = date.getFullYear();
  const M = date.getMonth() + 1;
  const D = date.getDate();
  const H = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return template
    .replace(/\{YYYY\}/g, String(YYYY))
    .replace(/\{MM\}/g, String(M).padStart(2, "0"))
    .replace(/\{M\}/g, String(M))
    .replace(/\{DD\}/g, String(D).padStart(2, "0"))
    .replace(/\{D\}/g, String(D))
    .replace(/\{HH\}/g, String(H).padStart(2, "0"))
    .replace(/\{mm\}/g, String(m).padStart(2, "0"))
    .replace(/\{ss\}/g, String(s).padStart(2, "0"))
    .replace(/\{MMMM\}/g, monthNames[date.getMonth()])
    .replace(/\{MMM\}/g, monthShort[date.getMonth()])
    .replace(/\{dddd\}/g, dayNames[date.getDay()])
    .replace(/\{ddd\}/g, dayShort[date.getDay()]);
}

/** Sanitize a string for use as a filename: strip illegal chars, trim, max 256 chars. */
function sanitizeFilename(thought: string): string {
  const illegal = /[\\/:*?"<>|\x00-\x1f]/g;
  const trimmed = thought.trim().replace(illegal, "").replace(/\s+/g, " ") || "entry";
  return trimmed.slice(0, 256);
}

/** Return file extension for image file name, or .png as fallback. */
function getImageExtension(fileName: string): string {
  const match = fileName.match(/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i);
  return match ? "." + match[1]!.toLowerCase() : ".png";
}

/** Parse tags string (e.g. "#a #b" or "a, b") into array of tag strings without #. */
function parseTagsInput(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,#]+/)) {
    const t = part.replace(/^#+/, "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Day-One style image grid slots.
 * 1 image → [path] (full)
 * 2 images → [path, path] (vertical split)
 * 3 images → [path, path, path, null] (grid of 4, 4th = icon)
 * 4+ images → first 4 paths (grid of 4)
 */
function getImageGridSlots(paths: string[]): (string | null)[] {
  if (paths.length === 0) return [];
  if (paths.length === 1) return [paths[0]!];
  if (paths.length === 2) return [paths[0]!, paths[1]!];
  if (paths.length === 3) return [paths[0]!, paths[1]!, paths[2]!, null];
  return [paths[0]!, paths[1]!, paths[2]!, paths[3]!];
}

/** New entry modal: Thought, Journal, Date/Time, Tags (with tag suggest). */
class NewEntryModal extends Modal {
  private thought = "";
  private journal = "";
  private dateTime = new Date();
  private tags = "";
  private journalNames: string[] = [];
  private defaultJournal: string | null = null;
  private onCreated: (() => void) | null = null;
  private tagSuggestEl: HTMLElement | null = null;
  private tagSuggestSelected = 0;
  private tagSuggestItems: string[] = [];
  private selectedFiles: File[] = [];
  private fileInputEl: HTMLInputElement | null = null;
  private mediaPreviewEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: DayWonPlugin,
    opts: {
      journalNames: string[];
      defaultJournal: string | null;
      onCreated: () => void;
    }
  ) {
    super(app);
    this.journalNames = opts.journalNames;
    this.defaultJournal = opts.defaultJournal;
    this.onCreated = opts.onCreated;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.selectedFiles = [];
    contentEl.addClass("day-won-new-entry-modal");
    contentEl.createEl("h2", { text: "New journal entry" });

    const thoughtWrap = contentEl.createDiv("day-won-modal-field");
    thoughtWrap.createEl("label", { text: "Thought" }).setAttribute("for", "day-won-thought");
    const thoughtInput = thoughtWrap.createEl("input", {
      type: "text",
      cls: "day-won-modal-input",
    }) as HTMLInputElement;
    thoughtInput.id = "day-won-thought";
    thoughtInput.placeholder = "What's on your mind?";
    thoughtInput.value = this.thought;

    const journalWrap = contentEl.createDiv("day-won-modal-field");
    journalWrap.createEl("label", { text: "Journal" }).setAttribute("for", "day-won-journal");
    const journalSelect = journalWrap.createEl("select", { cls: "day-won-modal-select day-won-modal-journal-select" }) as HTMLSelectElement;
    journalSelect.id = "day-won-journal";
    const options = this.journalNames.filter((n) => n !== "All");
    if (options.length === 0) options.push("Default");
    for (const name of options) {
      const opt = journalSelect.createEl("option", { value: name });
      opt.setText(name);
    }
    journalSelect.value =
      this.defaultJournal && options.includes(this.defaultJournal) ? this.defaultJournal : options[0]!;

    const dateWrap = contentEl.createDiv("day-won-modal-field");
    dateWrap.createEl("label", { text: "Date / Time" }).setAttribute("for", "day-won-datetime");
    const dateInput = dateWrap.createEl("input", {
      type: "datetime-local",
      cls: "day-won-modal-input",
    }) as HTMLInputElement;
    dateInput.id = "day-won-datetime";
    const now = new Date();
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const tagsWrap = contentEl.createDiv("day-won-modal-field");
    tagsWrap.createEl("label", { text: "Tags" }).setAttribute("for", "day-won-tags");
    const tagsContainer = tagsWrap.createDiv("day-won-modal-tags-wrap");
    const tagsInput = tagsContainer.createEl("input", {
      type: "text",
      cls: "day-won-modal-input",
    }) as HTMLInputElement;
    tagsInput.id = "day-won-tags";
    tagsInput.placeholder = "e.g. #daily #gratitude (type # for suggestions)";
    tagsInput.value = this.tags;
    this.tagSuggestEl = tagsContainer.createDiv("day-won-modal-tag-suggest");
    this.tagSuggestEl.addClass("is-hidden");
    tagsInput.addEventListener("input", () => this.onTagsInput(tagsInput));
    tagsInput.addEventListener("keydown", (e) => this.onTagsKeydown(e, tagsInput));
    tagsInput.addEventListener("focus", () => this.onTagsInput(tagsInput));
    tagsInput.addEventListener("blur", () => {
      setTimeout(() => this.hideTagSuggest(), 150);
    });

    const mediaWrap = contentEl.createDiv("day-won-modal-field");
    mediaWrap.createEl("label", { text: "Attachments" });
    const mediaRow = mediaWrap.createDiv("day-won-modal-media-row");
    this.fileInputEl = mediaRow.createEl("input", {
      type: "file",
      cls: "day-won-modal-file-input",
    }) as HTMLInputElement;
    this.fileInputEl.setAttribute("accept", "image/*");
    this.fileInputEl.setAttribute("multiple", "true");
    this.fileInputEl.style.display = "none";
    const addMediaBtn = mediaRow.createEl("button", { type: "button", cls: "day-won-modal-add-media" });
    setIcon(addMediaBtn, "image-plus");
    addMediaBtn.setText("Add images");
    addMediaBtn.addEventListener("click", () => this.fileInputEl?.click());
    this.fileInputEl.addEventListener("change", () => {
      const files = this.fileInputEl?.files;
      if (files?.length) {
        this.selectedFiles = [...this.selectedFiles, ...Array.from(files)];
        this.updateMediaPreview();
      }
      if (this.fileInputEl) this.fileInputEl.value = "";
    });
    this.mediaPreviewEl = mediaRow.createDiv("day-won-modal-media-preview");

    const actions = contentEl.createDiv("day-won-modal-actions");
    const submitBtn = actions.createEl("button", { type: "button", cls: "mod-cta" });
    submitBtn.setText("Create entry");
    const cancelBtn = actions.createEl("button", { type: "button" });
    cancelBtn.setText("Cancel");

    submitBtn.addEventListener("click", () => {
      this.thought = thoughtInput.value.trim();
      this.journal = journalSelect.value;
      this.dateTime = new Date(dateInput.value || Date.now());
      this.tags = tagsInput.value.trim();
      const files = [...this.selectedFiles];
      this.createEntry(files);
      this.close();
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private getTagSuggestions(prefix: string): string[] {
    const tagSet = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      const tags = getAllTags(cache);
      if (tags) for (const t of tags) tagSet.add(t.replace(/^#/, ""));
    }
    const list = [...tagSet].filter((t) => !prefix || t.toLowerCase().includes(prefix.toLowerCase()));
    return list.slice(0, 20);
  }

  private onTagsInput(input: HTMLInputElement) {
    const val = input.value;
    const cursor = input.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const hashIdx = before.lastIndexOf("#");
    if (hashIdx === -1) {
      this.hideTagSuggest();
      return;
    }
    const prefix = before.slice(hashIdx + 1).trim();
    this.tagSuggestItems = this.getTagSuggestions(prefix);
    if (this.tagSuggestItems.length === 0) {
      this.hideTagSuggest();
      return;
    }
    this.tagSuggestSelected = 0;
    this.showTagSuggest(input, prefix);
  }

  private showTagSuggest(input: HTMLInputElement, prefix: string) {
    if (!this.tagSuggestEl) return;
    this.tagSuggestEl.empty();
    this.tagSuggestEl.removeClass("is-hidden");
    for (let i = 0; i < this.tagSuggestItems.length; i++) {
      const tag = this.tagSuggestItems[i]!;
      const row = this.tagSuggestEl.createDiv("day-won-modal-tag-suggest-item");
      if (i === this.tagSuggestSelected) row.addClass("is-selected");
      row.setText(`#${tag}`);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.insertTag(input, tag);
      });
    }
  }

  private refreshTagSuggestHighlight() {
    if (!this.tagSuggestEl) return;
    const items = this.tagSuggestEl.querySelectorAll(".day-won-modal-tag-suggest-item");
    items.forEach((el, i) => el.classList.toggle("is-selected", i === this.tagSuggestSelected));
  }

  private hideTagSuggest() {
    if (this.tagSuggestEl) {
      this.tagSuggestEl.addClass("is-hidden");
      this.tagSuggestEl.empty();
    }
    this.tagSuggestItems = [];
  }

  private insertTag(input: HTMLInputElement, tag: string) {
    const val = input.value;
    const cursor = input.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const hashIdx = before.lastIndexOf("#");
    const start = hashIdx >= 0 ? hashIdx : cursor;
    const newVal = val.slice(0, start) + "#" + tag + " " + val.slice(cursor);
    input.value = newVal;
    input.setSelectionRange(start + tag.length + 2, start + tag.length + 2);
    input.focus();
    this.hideTagSuggest();
  }

  private updateMediaPreview() {
    if (!this.mediaPreviewEl) return;
    this.mediaPreviewEl.empty();
    if (this.selectedFiles.length === 0) return;
    const text = this.mediaPreviewEl.createSpan("day-won-modal-media-count");
    text.setText(`${this.selectedFiles.length} image${this.selectedFiles.length === 1 ? "" : "s"} selected`);
    const clearBtn = this.mediaPreviewEl.createEl("button", { type: "button", cls: "day-won-modal-media-clear" });
    clearBtn.setText("Clear");
    clearBtn.addEventListener("click", () => {
      this.selectedFiles = [];
      this.updateMediaPreview();
    });
  }

  private onTagsKeydown(e: KeyboardEvent, input: HTMLInputElement) {
    if (!this.tagSuggestEl?.hasClass("is-hidden") && this.tagSuggestItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.tagSuggestSelected = Math.min(this.tagSuggestSelected + 1, this.tagSuggestItems.length - 1);
        this.refreshTagSuggestHighlight();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.tagSuggestSelected = Math.max(0, this.tagSuggestSelected - 1);
        this.refreshTagSuggestHighlight();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const tag = this.tagSuggestItems[this.tagSuggestSelected];
        if (tag) this.insertTag(input, tag);
        return;
      }
      if (e.key === "Escape") {
        this.hideTagSuggest();
      }
    }
  }

  private async createEntry(selectedFiles: File[]) {
    const s = this.plugin.settings;
    const dateProp = s.dateProperty || "date";
    const journalProp = s.journalProperty || "journal";
    const entryProp = s.entryProperty || "entry";
    const template = s.defaultJournalEntryLocation?.trim() || "Journal/{YYYY}/{MM}-{MMMM}";
    const dir = formatPathWithDate(template, this.dateTime);
    const title = sanitizeFilename(this.thought);
    const mode = s.attachmentMode ?? "subfolder";
    const filename =
      mode === "subfolder"
        ? `${dir}/${title}/${title}.md`.replace(/\/+/g, "/")
        : `${dir}/${title}.md`.replace(/\/+/g, "/");
    const tagsArr = parseTagsInput(this.tags);
    const timeStr = this.dateTime.toTimeString().slice(0, 5);
    const frontmatter: Record<string, unknown> = {
      [dateProp]: this.dateTime.toISOString().slice(0, 10),
      [journalProp]: this.journal,
      [entryProp]: this.thought || title,
    };
    if (s.timeProperty) frontmatter[s.timeProperty] = timeStr;
    if (tagsArr.length > 0) frontmatter.tags = tagsArr;
    const fmBlock =
      "---\n" +
      Object.entries(frontmatter)
        .map(([k, v]) => {
          if (Array.isArray(v)) {
            const items = (v as string[]).map((x) => (x.includes(" ") || x.includes(",") ? `"${x}"` : x));
            return `${k}: [${items.join(", ")}]`;
          }
          return `${k}: ${v}`;
        })
        .join("\n") +
      "\n---\n\n";

    let body = this.thought ? `${this.thought}\n\n` : "";
    const imageLinks: string[] = [];

    const noteDir = mode === "subfolder" ? `${dir}/${title}`.replace(/\/+$/, "") : dir.replace(/\/+$/, "");
    const noteDirParts = noteDir.split("/").filter(Boolean);
    for (let i = 1; i <= noteDirParts.length; i++) {
      const p = noteDirParts.slice(0, i).join("/");
      if (p) await this.app.vault.adapter.mkdir(p);
    }

    if (selectedFiles.length > 0) {
      let attachmentDir: string;
      if (mode === "subfolder") {
        attachmentDir = noteDir;
      } else {
        const assetsTemplate = s.assetsFolderPath?.trim() || "Assets/{YYYY}/{MM}-{MMMM}";
        attachmentDir = formatPathWithDate(assetsTemplate, this.dateTime).replace(/\/+$/, "");
        const attachmentParts = attachmentDir.split("/").filter(Boolean);
        for (let i = 1; i <= attachmentParts.length; i++) {
          const p = attachmentParts.slice(0, i).join("/");
          if (p) await this.app.vault.adapter.mkdir(p);
        }
      }
      const usedNames = new Map<string, number>();
      for (const file of selectedFiles) {
        const ext = getImageExtension(file.name) || ".png";
        const base = sanitizeFilename(file.name.replace(/\.[^.]+$/, "")).slice(0, 80) || "image";
        let name = base + ext;
        const count = (usedNames.get(base) ?? 0) + 1;
        usedNames.set(base, count);
        if (count > 1) name = `${base}-${count}${ext}`;
        const imagePath = `${attachmentDir}/${name}`.replace(/\/+/g, "/");
        const arrayBuffer = await file.arrayBuffer();
        await this.app.vault.createBinary(imagePath, arrayBuffer);
        imageLinks.push(imagePath);
      }
      for (const imagePath of imageLinks) {
        body += `![[${imagePath}]]\n\n`;
      }
    }

    const content = fmBlock + body;
    const created = await this.app.vault.create(filename, content);
    if (this.onCreated) this.onCreated();
    this.app.workspace.getLeaf().openFile(created);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export const VIEW_TYPE_DAY_WON = "day-won-view";
export const VIEW_TYPE_DAY_WON_DAY = "day-won-day-view";

export interface DayDetailState {
  dateKey: string;
  journalFilter: string | null;
}

/** Relative luminance 0–1; use to pick light or dark text on a background. */
function luminance(hexOrRgb: string): number {
  let r = 0,
    g = 0,
    b = 0;
  const hex = hexOrRgb.replace(/^#/, "");
  if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16) / 255;
    g = parseInt(hex.slice(2, 4), 16) / 255;
    b = parseInt(hex.slice(4, 6), 16) / 255;
  }
  const l = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}

function formatDate(
  dateKey: string,
  format: "monthYear" | "dayShort" | "full" | "dayFull"
): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (format === "monthYear")
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (format === "dayShort")
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  if (format === "dayFull")
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

type TabId = "summary" | "list" | "calendar";

export class DayWonView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: DayWonPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DAY_WON;
  }

  getDisplayText(): string {
    return this.plugin.settings.journalName || "Day Won";
  }

  getIcon(): string {
    return VIEW_ICON;
  }

  private activeTab: TabId = "calendar";
  private entries: JournalEntry[] = [];
  private loading = true;
  private error: string | null = null;
  /** Selected journal filter: null = "All", otherwise journal name (e.g. Life, Daily). */
  private selectedJournal: string | null = null;
  private calendarMonthsRendered = 12;
  private calendarSentinel: HTMLElement | null = null;
  private calendarObserver: IntersectionObserver | null = null;

  /** Journal names to show in the picker: only those with showInPicker and present in entries. */
  private getJournalNames(): string[] {
    const configs = this.plugin.settings.journalConfigs ?? {};
    const set = new Set<string>();
    for (const e of this.entries) {
      const name = e.journal || "Default";
      if (configs[name]?.showInPicker !== false) set.add(name);
    }
    return ["All", ...[...set].sort((a, b) => (a === "Default" ? 1 : a.localeCompare(b)))];
  }

  /** Entries filtered by selected journal (or all if "All"). */
  private getFilteredEntries(): JournalEntry[] {
    if (this.selectedJournal === null || this.selectedJournal === "All") return this.entries;
    return this.entries.filter((e) => (e.journal || "Default") === this.selectedJournal);
  }

  /** Resolve image path to a URL (external URLs as-is; vault paths resolved). */
  private getImageUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return this.app.vault.getResourcePath(file);
    for (const ext of ["", ".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
      const f = this.app.vault.getAbstractFileByPath(path + ext);
      if (f instanceof TFile) return this.app.vault.getResourcePath(f);
    }
    const filename = path.includes("/") ? path.split("/").pop()! : path;
    const found = this.app.vault.getFiles().find((f) => f.name === filename);
    if (found) return this.app.vault.getResourcePath(found);
    return this.app.vault.adapter.getResourcePath(path);
  }

  /** Render Day-One style image grid into parent. slots from getImageGridSlots(); iconForEmpty used for 4th cell when 3 images. */
  private renderImageGrid(
    parent: HTMLElement,
    slots: (string | null)[],
    iconForEmpty: string
  ): void {
    if (slots.length === 0) return;
    const grid = parent.createDiv("day-won-image-grid");
    const count = slots.length;
    grid.classList.add(
      count === 1 ? "day-won-image-grid-full" :
      count === 2 ? "day-won-image-grid-split2" :
      "day-won-image-grid-4"
    );
    for (const slot of slots) {
      const cell = grid.createDiv("day-won-image-grid-cell");
      if (slot) {
        const img = document.createElement("img");
        img.src = this.getImageUrl(slot);
        img.alt = "";
        img.loading = "lazy";
        cell.appendChild(img);
      } else {
        cell.addClass("day-won-image-grid-cell-icon");
        setIcon(cell.createSpan(), iconForEmpty);
      }
    }
  }

  /** Journal color for calendar dots/borders (from config or default). */
  private getJournalColor(journalName: string): string {
    const configs = this.plugin.settings.journalConfigs ?? {};
    return configs[journalName]?.color ?? getDefaultJournalColor(journalName);
  }

  /** Header color for selected journal: from settings or fallback. */
  private journalHeaderColor(journal: string | null): { bg: string; fg: string } {
    if (journal === null || journal === "All") {
      return { bg: "var(--interactive-accent)", fg: "#fff" };
    }
    const configs = this.plugin.settings.journalConfigs ?? {};
    const cfg = configs[journal];
    if (cfg?.color) {
      return { bg: cfg.color, fg: luminance(cfg.color) > 0.45 ? "#1a1a1a" : "#fff" };
    }
    const theme = document.body.classList.contains("theme-dark") ? "dark" : "light";
    const palette: Record<string, { bg: string; fg: string }> = {
      Life: { bg: "#f5c842", fg: "#1a1a1a" },
      Daily: { bg: "#4caf50", fg: "#fff" },
      Stats: { bg: "#2196f3", fg: "#fff" },
      Default: { bg: "#78909c", fg: "#fff" },
    };
    if (palette[journal]) return palette[journal];
    let h = 0;
    for (let i = 0; i < journal.length; i++) h = (h << 5) - h + journal.charCodeAt(i);
    h = Math.abs(h) % 360;
    const s = theme === "dark" ? 45 : 55;
    const l = theme === "dark" ? 42 : 52;
    return { bg: `hsl(${h}, ${s}%, ${l}%)`, fg: "#1a1a1a" };
  }

  async onOpen() {
    await this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      const folders = parseFolderList(
        this.plugin.settings.journalFolders ?? this.plugin.settings.journalFolder ?? "Journal"
      );
      const s = this.plugin.settings;
      this.entries = await getJournalEntries(
        this.app.vault,
        this.app.metadataCache,
        folders.length > 0 ? folders : [], // empty = whole vault handled inside getJournalEntries via parseFolderList
        s.dateProperty,
        s.timeProperty || "",
        s.entryProperty || "entry",
        s.journalProperty || "journal",
        entryTypesToRuleShape(this.plugin.settings.entryTypes),
        this.plugin.settings.lapseEntriesProperty ?? "lapseEntries",
        this.plugin.settings.leafletLatProperty ?? "lat",
        this.plugin.settings.leafletLongProperty ?? "long"
      );
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.loading = false;
    this.render();
  }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClasses(["day-won", "day-won-view"]);

    const filtered = this.getFilteredEntries();
    const header = el.createDiv("day-won-header");
    const headerColor = this.journalHeaderColor(this.selectedJournal);
    header.style.setProperty("--day-won-header-bg", headerColor.bg);
    header.style.setProperty("--day-won-header-fg", headerColor.fg);

    const headerRow = header.createDiv("day-won-header-row");
    const titleWrap = headerRow.createDiv("day-won-title-wrap");
    const title = titleWrap.createEl("h1", "day-won-title");
    title.setText(
      this.selectedJournal === null || this.selectedJournal === "All"
        ? this.plugin.settings.journalName || "All"
        : this.selectedJournal
    );
    const range = titleWrap.createEl("div", "day-won-range");
    range.setText(this.getDateRangeForEntries(filtered));
    range.setAttribute("aria-hidden", "true");

    const pickerWrap = headerRow.createDiv("day-won-picker-wrap");
    const picker = pickerWrap.createEl("select", "day-won-picker");
    picker.setAttribute("aria-label", "Journal");
    const journalNames = this.getJournalNames();
    for (const name of journalNames) {
      picker.createEl("option", { value: name }).setText(name);
    }
    picker.value = this.selectedJournal === null ? "All" : this.selectedJournal;
    picker.addEventListener("change", () => {
      const v = picker.value;
      this.selectedJournal = v === "All" ? null : v;
      this.render();
    });

    const addBtn = headerRow.createEl("button", "day-won-add-entry");
    addBtn.setAttribute("aria-label", "New journal entry");
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => {
      const modal = new NewEntryModal(this.app, this.plugin, {
        journalNames: this.getJournalNames().filter((n) => n !== "All"),
        defaultJournal: this.selectedJournal && this.selectedJournal !== "All" ? this.selectedJournal : null,
        onCreated: () => this.refresh(),
      });
      modal.open();
    });

    const refreshBtn = headerRow.createEl("button", "day-won-refresh");
    refreshBtn.setAttribute("aria-label", "Refresh journal data");
    refreshBtn.setText("↻");
    refreshBtn.addEventListener("click", () => {
      this.refresh();
    });

    const nav = header.createDiv("day-won-nav");
    for (const tab of [
      { id: "calendar" as TabId, label: "Calendar", icon: "calendar" },
      { id: "list" as TabId, label: "List", icon: "list" },
      { id: "summary" as TabId, label: "Summary", icon: "book-open" },
    ]) {
      const btn = nav.createEl("button", "day-won-tab");
      if (tab.id === this.activeTab) btn.addClass("is-active");
      setIcon(btn.createSpan("day-won-tab-icon"), tab.icon);
      btn.createSpan("day-won-tab-label").setText(tab.label);
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.render();
      });
    }

    const body = el.createDiv("day-won-body");
    if (this.loading) {
      body.createDiv("day-won-loading").setText("Loading…");
      return;
    }
    if (this.error) {
      body.createDiv("day-won-error", (e) => e.setText(this.error!));
      return;
    }

    if (this.activeTab === "summary") this.renderSummary(body, filtered);
    else if (this.activeTab === "list") this.renderList(body, filtered);
    else this.renderCalendar(body, filtered);
  }

  private getDateRangeForEntries(entries: JournalEntry[]): string {
    if (entries.length === 0) return "—";
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0].date;
    const last = sorted[sorted.length - 1].date;
    const y1 = first.slice(0, 4);
    const y2 = last.slice(0, 4);
    return y1 === y2 ? y1 : `${y1}–${y2}`;
  }

  private renderSummary(container: HTMLElement, entries: JournalEntry[]) {
    const streak = computeStreak(entries);
    const uniqueDays = new Set(entries.map((e) => e.date)).size;
    const mediaCount = entries.filter((e) => e.firstImagePath).length;
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const onThisDayCountNum = onThisDayCount(entries, month, day);
    const onThisDayEntries = getOnThisDayEntries(entries, month, day);

    const stats = container.createDiv("day-won-stats");
    const items = [
      { label: "STREAK", value: `${streak} Days` },
      { label: "ENTRIES", value: String(this.entries.length) },
      { label: "MEDIA", value: String(mediaCount) },
      { label: "DAYS", value: String(uniqueDays) },
      { label: "ON THIS DAY", value: String(onThisDayCountNum) },
    ];
    for (const { label, value } of items) {
      const block = stats.createDiv("day-won-stat");
      block.createEl("div", "day-won-stat-label").setText(label);
      block.createEl("div", "day-won-stat-value").setText(value);
    }

    if (onThisDayEntries.length > 0) {
      const section = container.createDiv("day-won-summary-on-this-day");
      section.createEl("h2", "day-won-summary-on-this-day-title").setText("On This Day");
      const list = section.createDiv("day-won-summary-on-this-day-list");
      for (const entry of onThisDayEntries) {
        const row = list.createDiv("day-won-summary-on-this-day-entry");
        if (entry.firstImagePath) {
          const thumbWrap = row.createDiv("day-won-summary-on-this-day-thumb");
          const img = document.createElement("img");
          img.src = this.getImageUrl(entry.firstImagePath);
          img.alt = "";
          img.loading = "lazy";
          thumbWrap.appendChild(img);
        }
        const textWrap = row.createDiv("day-won-summary-on-this-day-text");
        textWrap.createEl("span", "day-won-summary-on-this-day-year").setText(entry.date.slice(0, 4));
        textWrap.createEl("span", "day-won-summary-on-this-day-name").setText(entry.name);
        row.addEventListener("click", () => this.openEntry(entry));
      }
    }
  }

  private renderList(container: HTMLElement, entries: JournalEntry[]) {
    const listEl = container.createDiv("day-won-list");
    const isAll = this.selectedJournal === null || this.selectedJournal === "All";

    if (isAll) {
      const byDate = groupEntriesByDate(entries);
      const dateKeys = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
      let lastYear = "";
      let lastMonth = "";
      for (const dateKey of dateKeys) {
        const dayEntries = byDate.get(dateKey) ?? [];
        const [y, m, d] = dateKey.split("-").map(Number);
        const year = String(y);
        const monthKey = `${y}-${String(m).padStart(2, "0")}`;
        if (year !== lastYear) {
          lastYear = year;
          listEl.createEl("h3", "day-won-list-year-title").setText(year);
        }
        if (monthKey !== lastMonth) {
          lastMonth = monthKey;
          listEl.createEl("h4", "day-won-list-month-title").setText(
            formatDate(monthKey + "-01", "monthYear")
          );
        }
        const dayGroup = listEl.createDiv("day-won-list-day-group");
        const dayHeaderWrap = dayGroup.createDiv("day-won-list-day-header-wrap");
        const date = new Date(y, m - 1, d);
        dayHeaderWrap.createEl("div", "day-won-list-day-weekday").setText(
          date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 3)
        );
        dayHeaderWrap.createEl("div", "day-won-list-day-num").setText(String(d));
        const dayEntriesWrap = dayGroup.createDiv("day-won-list-day-entries");
        for (const entry of dayEntries) {
          const row = dayEntriesWrap.createDiv("day-won-list-entry");
          const time = entry.time ? entry.time.slice(0, 5) : "";
          if (time) row.createSpan("day-won-list-time").setText(time);
          const content = row.createDiv("day-won-list-content");
          const textBlock = content.createDiv("day-won-list-text");
          textBlock.createDiv("day-won-list-title").setText(entry.name);
          const showSnippet =
            entry.preview &&
            entry.preview.trim() !== entry.name.trim() &&
            entry.preview.trim() !== entry.file.basename.replace(/\.md$/i, "");
          if (showSnippet) {
            textBlock.createDiv("day-won-list-snippet").setText(entry.preview.trim());
          }
          const listPaths = entry.imagePaths?.length ? entry.imagePaths : (entry.firstImagePath ? [entry.firstImagePath] : []);
          const listSlots = getImageGridSlots(listPaths);
          if (listSlots.length > 0) {
            const thumbWrap = content.createDiv("day-won-list-thumb day-won-list-thumb-grid");
            this.renderImageGrid(thumbWrap, listSlots, this.getEntryIcon(entry));
          } else {
            const iconWrap = content.createDiv("day-won-list-thumb day-won-list-thumb-icon");
            iconWrap.style.setProperty("--day-won-entry-icon-color", this.getJournalColor(entry.journal || "Default"));
            const icon = this.getEntryIcon(entry);
            setIcon(iconWrap.createSpan("day-won-list-entry-icon"), icon);
          }
          row.addEventListener("click", () => this.openEntry(entry));
        }
      }
      return;
    }

    const byJournal = groupEntriesByJournal(entries);
    const journalNames = [...byJournal.keys()].sort();
    for (const journalName of journalNames) {
      const journalEntries = byJournal.get(journalName) ?? [];
      const section = listEl.createDiv("day-won-list-journal-section");

      let lastYear = "";
      let lastMonth = "";
      let lastDate = "";
      let dayEntriesWrap: HTMLElement | null = null;
      for (const entry of journalEntries) {
        const [y, m, d] = entry.date.split("-").map(Number);
        const year = String(y);
        const monthKey = `${y}-${String(m).padStart(2, "0")}`;
        if (year !== lastYear) {
          lastYear = year;
          section.createEl("h3", "day-won-list-year-title").setText(year);
        }
        if (monthKey !== lastMonth) {
          lastMonth = monthKey;
          section.createEl("h4", "day-won-list-month-title").setText(
            formatDate(monthKey + "-01", "monthYear")
          );
        }
        if (entry.date !== lastDate) {
          lastDate = entry.date;
          const dayGroup = section.createDiv("day-won-list-day-group");
          const dayHeaderWrap = dayGroup.createDiv("day-won-list-day-header-wrap");
          const date = new Date(y, m - 1, d);
          dayHeaderWrap.createEl("div", "day-won-list-day-weekday").setText(
            date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase().slice(0, 3)
          );
          dayHeaderWrap.createEl("div", "day-won-list-day-num").setText(String(d));
          dayEntriesWrap = dayGroup.createDiv("day-won-list-day-entries");
        }
        const row = dayEntriesWrap!.createDiv("day-won-list-entry");
        const time = entry.time ? entry.time.slice(0, 5) : "";
        if (time) row.createSpan("day-won-list-time").setText(time);
        const content = row.createDiv("day-won-list-content");
        const textBlock = content.createDiv("day-won-list-text");
        textBlock.createDiv("day-won-list-title").setText(entry.name);
        const showSnippet =
          entry.preview &&
          entry.preview.trim() !== entry.name.trim() &&
          entry.preview.trim() !== entry.file.basename.replace(/\.md$/i, "");
        if (showSnippet) {
          textBlock.createDiv("day-won-list-snippet").setText(entry.preview.trim());
        }
        const listPaths = entry.imagePaths?.length ? entry.imagePaths : (entry.firstImagePath ? [entry.firstImagePath] : []);
        const listSlots = getImageGridSlots(listPaths);
        if (listSlots.length > 0) {
          const thumbWrap = content.createDiv("day-won-list-thumb day-won-list-thumb-grid");
          this.renderImageGrid(thumbWrap, listSlots, this.getEntryIcon(entry));
        } else {
          const iconWrap = content.createDiv("day-won-list-thumb day-won-list-thumb-icon");
          iconWrap.style.setProperty("--day-won-entry-icon-color", this.getJournalColor(entry.journal || "Default"));
          const icon = this.getEntryIcon(entry);
          setIcon(iconWrap.createSpan("day-won-list-entry-icon"), icon);
        }
        row.addEventListener("click", () => this.openEntry(entry));
      }
    }
  }

  /** Icon chain: user entry type (settings order) → lapse (timer) → default (file-text). */
  private getEntryIcon(entry: JournalEntry): string {
    if (entry.entryType) return this.getEntryTypeIcon(entry.entryType);
    if (entry.hasLapseEntries) return "timer";
    return "file-text";
  }

  private getEntryTypeIcon(typeName: string | null): string {
    if (!typeName) return "file-text";
    const t = (this.plugin.settings.entryTypes ?? []).find(
      (e) => e.name.trim().toLowerCase() === typeName.trim().toLowerCase()
    );
    return t?.icon?.trim() || "file-text";
  }

  private todayKey(): string {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }

  private createCalendarDayCell(
    dateKey: string,
    dayNum: number,
    dayEntries: JournalEntry[]
  ): HTMLElement {
    const cell = document.createElement("div");
    cell.className = "day-won-calendar-cell day-won-calendar-cell-day";
    const isToday = dateKey === this.todayKey();
    if (isToday) cell.classList.add("is-today");
    const isAllView =
      this.selectedJournal === null || this.selectedJournal === "All";

    const aggregatedPaths: string[] = [];
    for (const e of dayEntries) {
      if (e.imagePaths?.length) aggregatedPaths.push(...e.imagePaths);
      else if (e.firstImagePath) aggregatedPaths.push(e.firstImagePath);
    }
    const gridSlots = getImageGridSlots(aggregatedPaths);

    if (gridSlots.length > 0) {
      this.renderImageGrid(cell, gridSlots, "image");
    } else if (!isAllView && this.selectedJournal && dayEntries.length > 0) {
      cell.style.borderColor = this.getJournalColor(this.selectedJournal);
      cell.style.borderWidth = "2px";
    }

    if (dayEntries.length > 0) {
      const num = document.createElement("div");
      num.className = "day-won-calendar-day-num";
      num.textContent = String(dayNum);
      cell.appendChild(num);
      const dots = document.createElement("div");
      dots.className = "day-won-calendar-day-dots";
      const color = isAllView
        ? undefined
        : this.getJournalColor(this.selectedJournal || dayEntries[0].journal || "Default");
      for (const e of dayEntries) {
        const dot = document.createElement("span");
        dot.className = "day-won-calendar-dot";
        dot.style.backgroundColor = color ?? this.getJournalColor(e.journal || "Default");
        dots.appendChild(dot);
      }
      cell.appendChild(dots);
      cell.classList.add("has-entries");
      cell.addEventListener("click", () => this.openDay(dateKey, dayEntries));
    } else {
      const num = document.createElement("div");
      num.className = "day-won-calendar-day-num";
      num.textContent = String(dayNum);
      cell.appendChild(num);
    }
    return cell;
  }

  private renderCalendar(container: HTMLElement, entries: JournalEntry[]) {
    const byDate = groupEntriesByDate(entries);
    const scrollWrap = container.createDiv("day-won-calendar-scroll");

    const renderMonth = (year: number, month: number) => {
      const monthEl = scrollWrap.createDiv("day-won-calendar-month");
      monthEl.createEl("h2", "day-won-calendar-title").setText(
        new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      );
      const grid = monthEl.createDiv("day-won-calendar-grid");
      const dayNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
      for (const d of dayNames) {
        const cell = grid.createDiv("day-won-calendar-cell day-won-calendar-cell-head");
        cell.setText(d);
      }
      const first = new Date(year, month, 1);
      let start = first.getDay() - 1;
      if (start < 0) start += 7;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let i = 0; i < start; i++) {
        grid.createDiv("day-won-calendar-cell day-won-calendar-cell-empty");
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const dayEntries = byDate.get(dateKey) ?? [];
        grid.appendChild(
          this.createCalendarDayCell(dateKey, d, dayEntries)
        );
      }
    };

    const now = new Date();
    for (let i = 0; i < this.calendarMonthsRendered; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      renderMonth(d.getFullYear(), d.getMonth());
    }

    const sentinel = scrollWrap.createDiv("day-won-calendar-sentinel");
    sentinel.setAttribute("aria-hidden", "true");

    this.calendarObserver?.disconnect();
    this.calendarSentinel = sentinel;
    this.calendarObserver = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || !this.calendarSentinel?.parentElement) return;
        const parent = this.calendarSentinel.parentElement as HTMLElement;
        const now2 = new Date();
        for (let i = this.calendarMonthsRendered; i < this.calendarMonthsRendered + 6; i++) {
          const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
          const monthEl = document.createElement("div");
          monthEl.className = "day-won-calendar-month";
          const title = document.createElement("h2");
          title.className = "day-won-calendar-title";
          title.textContent = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          });
          monthEl.appendChild(title);
          const grid = document.createElement("div");
          grid.className = "day-won-calendar-grid";
          ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].forEach((day) => {
            const cell = document.createElement("div");
            cell.className = "day-won-calendar-cell day-won-calendar-cell-head";
            cell.textContent = day;
            grid.appendChild(cell);
          });
          const year = d.getFullYear();
          const month = d.getMonth();
          const first = new Date(year, month, 1);
          let start = first.getDay() - 1;
          if (start < 0) start += 7;
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          for (let j = 0; j < start; j++) {
            const cell = document.createElement("div");
            cell.className = "day-won-calendar-cell day-won-calendar-cell-empty";
            grid.appendChild(cell);
          }
          const byDateLoad = groupEntriesByDate(this.getFilteredEntries());
          for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEntries = byDateLoad.get(dateKey) ?? [];
            grid.appendChild(this.createCalendarDayCell(dateKey, day, dayEntries));
          }
          monthEl.appendChild(grid);
          parent.insertBefore(monthEl, this.calendarSentinel);
        }
        this.calendarMonthsRendered += 6;
      },
      { root: scrollWrap.parentElement, rootMargin: "200px", threshold: 0 }
    );
    this.calendarObserver.observe(sentinel);
  }

  private openEntry(entry: JournalEntry) {
    this.app.workspace.getLeaf(false).openFile(entry.file);
  }

  private openDay(dateKey: string, entries: JournalEntry[]) {
    const leaf = this.app.workspace.getLeaf(true);
    leaf.setViewState({
      type: VIEW_TYPE_DAY_WON_DAY,
      state: {
        dateKey,
        journalFilter: this.selectedJournal === "All" ? null : this.selectedJournal,
      } satisfies DayDetailState,
    });
  }
}

/** Build a ```leaflet block for the day view from entries with lat/long (Obsidian Leaflet plugin). */
function buildDayLeafletMarkdown(entries: JournalEntry[], dateKey: string): string | null {
  const withCoords = entries.filter((e) => e.latitude != null && e.longitude != null);
  if (withCoords.length === 0) return null;
  const id = `day_won_${dateKey.replace(/-/g, "_")}`;
  const sumLat = withCoords.reduce((s, e) => s + e.latitude!, 0);
  const sumLng = withCoords.reduce((s, e) => s + e.longitude!, 0);
  const n = withCoords.length;
  const lines = [
    `id: ${id}`,
    `lat: ${sumLat / n}`,
    `long: ${sumLng / n}`,
    "showAllMarkers: true",
  ];
  for (const e of withCoords) {
    const pathNoExt = e.file.path.replace(/\.md$/i, "");
    lines.push(`marker: default, ${e.latitude}, ${e.longitude}, [[${pathNoExt}]]`);
  }
  return "```leaflet\n" + lines.join("\n") + "\n```";
}

/** Full-page Day One–style view for a single day: aggregated entries, tiled images, type cards. */
export class DayDetailView extends ItemView {
  static readonly VIEW_TYPE = VIEW_TYPE_DAY_WON_DAY;
  private state: DayDetailState = { dateKey: "", journalFilter: null };
  private entries: JournalEntry[] = [];
  private loading = true;

  constructor(leaf: WorkspaceLeaf, private plugin: DayWonPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return DayDetailView.VIEW_TYPE;
  }

  getDisplayText(): string {
    const key = this.state.dateKey || "";
    const parts = key.split("-").map(Number);
    if (parts.length < 3) return "Day";
    const [y, m, d] = parts;
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return "Day";
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  getState(): Record<string, unknown> {
    return this.state as unknown as Record<string, unknown>;
  }

  setState(state: unknown): Promise<void> {
    const s = state as Partial<DayDetailState>;
    if (s && typeof s.dateKey === "string") {
      this.state = {
        dateKey: s.dateKey,
        journalFilter: s.journalFilter ?? null,
      };
    }
    return this.loadEntries();
  }

  async onOpen() {
    await this.loadEntries();
  }

  /** Reload entries for the current day (e.g. after file change). */
  async refresh() {
    await this.loadEntries();
  }

  private getImageUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return this.app.vault.getResourcePath(file);
    for (const ext of ["", ".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
      const f = this.app.vault.getAbstractFileByPath(path + ext);
      if (f instanceof TFile) return this.app.vault.getResourcePath(f);
    }
    const filename = path.includes("/") ? path.split("/").pop()! : path;
    const found = this.app.vault.getFiles().find((f) => f.name === filename);
    if (found) return this.app.vault.getResourcePath(found);
    return this.app.vault.adapter.getResourcePath(path);
  }

  private async loadEntries() {
    this.loading = true;
    this.render();
    try {
      const folders = parseFolderList(
        this.plugin.settings.journalFolders ?? this.plugin.settings.journalFolder ?? "Journal"
      );
      const s = this.plugin.settings;
      const all = await getJournalEntries(
        this.app.vault,
        this.app.metadataCache,
        folders.length > 0 ? folders : [],
        s.dateProperty,
        s.timeProperty || "",
        s.entryProperty || "entry",
        s.journalProperty || "journal",
        entryTypesToRuleShape(this.plugin.settings.entryTypes),
        this.plugin.settings.lapseEntriesProperty ?? "lapseEntries",
        this.plugin.settings.leafletLatProperty ?? "lat",
        this.plugin.settings.leafletLongProperty ?? "long"
      );
      let list = all.filter((e) => e.date === this.state.dateKey);
      if (this.state.journalFilter != null && this.state.journalFilter !== "All") {
        list = list.filter((e) => (e.journal || "Default") === this.state.journalFilter);
      }
      list.sort((a, b) => (a.time || "00:00").localeCompare(b.time || "00:00"));
      this.entries = list;
    } catch {
      this.entries = [];
    }
    this.loading = false;
    this.render();
  }

  private render() {
    const el = this.contentEl;
    el.empty();
    el.addClasses(["day-won", "day-won-day-detail"]);

    if (this.loading) {
      el.createDiv("day-won-day-loading").setText("Loading…");
      return;
    }

    const [y, m, d] = this.state.dateKey.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const prevDate = new Date(y, m - 1, d - 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}-${String(prevDate.getDate()).padStart(2, "0")}`;
    const nextDate = new Date(y, m - 1, d + 1);
    const nextKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;

    const header = el.createDiv("day-won-day-header");
    const navRow = header.createDiv("day-won-day-nav-row");
    const backBtn = navRow.createEl("button", "day-won-day-back");
    backBtn.setAttribute("aria-label", "Back");
    setIcon(backBtn, "arrow-left");
    backBtn.addEventListener("click", () => this.app.workspace.activeLeaf?.detach());

    const dateWrap = navRow.createDiv("day-won-day-date-wrap");
    dateWrap.createEl("div", "day-won-day-date").setText(
      date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    );
    const ago = this.yearsAgo(date);
    if (ago) dateWrap.createEl("div", "day-won-day-ago").setText(ago);

    const prevBtn = navRow.createEl("button", "day-won-day-arrow");
    setIcon(prevBtn, "chevron-left");
    prevBtn.setAttribute("aria-label", "Previous day");
    prevBtn.addEventListener("click", () => this.navigateTo(prevKey));
    const nextBtn = navRow.createEl("button", "day-won-day-arrow");
    setIcon(nextBtn, "chevron-right");
    nextBtn.setAttribute("aria-label", "Next day");
    nextBtn.addEventListener("click", () => this.navigateTo(nextKey));

    const countRow = header.createDiv("day-won-day-count-row");
    countRow.createEl("span", "day-won-day-count").setText(
      this.entries.length === 1 ? "1 Entry" : `${this.entries.length} Entries`
    );

    const body = el.createDiv("day-won-day-body");
    if (this.entries.length === 0) {
      body.createDiv("day-won-day-empty").setText("No entries for this day.");
      return;
    }

    if (this.plugin.settings.useLeafletMaps) {
      const leafletMd = buildDayLeafletMarkdown(this.entries, this.state.dateKey);
      if (leafletMd) {
        const leafletWrap = body.createDiv("day-won-day-leaflet");
        void this.renderLeafletMarkdown(leafletWrap, leafletMd);
      }
    }

    const cardList = body.createDiv("day-won-day-card-list");
    for (const entry of this.entries) {
      const card = cardList.createDiv("day-won-day-card");
      card.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest("a")) {
          this.app.workspace.getLeaf(false).openFile(entry.file);
        }
      });

      const cover = entry.coverImagePath;
      const bodyImages = (entry.imagePaths ?? []).filter((p) => p !== cover);
      const hasCover = Boolean(cover);

      if (hasCover && cover) {
        const header = card.createDiv("day-won-day-card-header day-won-day-card-header-image");
        header.style.backgroundImage = `url(${this.getImageUrl(cover)})`;
      }

      const cardBody = card.createDiv("day-won-day-card-body");
      const row = cardBody.createDiv("day-won-day-card-body-row");
      /* Icon: user entry type (settings order) → lapse (timer) → default (file-text). Color from entry's journal. */
      const iconWrap = row.createDiv("day-won-day-card-icon-wrap");
      iconWrap.style.setProperty("--day-won-entry-icon-color", this.getJournalColor(entry.journal || "Default"));
      const icon = entry.entryType
        ? this.getEntryTypeIcon(entry.entryType)
        : entry.hasLapseEntries
          ? "timer"
          : "file-text";
      if (entry.entryType) iconWrap.addClass(`day-won-day-type-${(entry.entryType ?? "").replace(/\s+/g, "-")}`);
      else if (entry.hasLapseEntries) iconWrap.addClass("day-won-day-type-lapse");
      else iconWrap.addClass("day-won-day-type-default");
      setIcon(iconWrap.createSpan("day-won-day-card-icon"), icon);
      const textWrap = row.createDiv("day-won-day-card-text");
      if (entry.time && entry.time.trim()) {
        const timeStr = entry.time.trim().slice(0, 5);
        if (timeStr) textWrap.createEl("div", "day-won-day-card-time").setText(timeStr);
      }
      textWrap.createEl("div", "day-won-day-card-name").setText(entry.name);
      if (entry.isMedia && (entry.showTitle ?? entry.season ?? entry.episode)) {
        const parts: string[] = [];
        if (entry.showTitle) parts.push(entry.showTitle);
        if (entry.season != null) parts.push(`Season ${entry.season}`);
        if (entry.episode != null) parts.push(`Episode ${entry.episode}`);
        if (parts.length > 0) {
          textWrap.createEl("div", "day-won-day-card-media-subtitle").setText(parts.join(" "));
        }
      }

      if (bodyImages.length > 0) {
        const grid = cardBody.createDiv("day-won-day-card-images");
        grid.setAttribute("data-count", String(bodyImages.length));
        for (const path of bodyImages) {
          const cell = grid.createDiv("day-won-day-card-image-cell");
          const img = document.createElement("img");
          img.src = this.getImageUrl(path);
          img.alt = "";
          img.loading = "lazy";
          cell.appendChild(img);
        }
      }
    }
  }

  private async renderLeafletMarkdown(container: HTMLElement, markdown: string) {
    container.empty();
    const firstWithCoords = this.entries.find((e) => e.latitude != null && e.longitude != null);
    const sourcePath = firstWithCoords?.file.path ?? "";
    try {
      await MarkdownRenderer.render(this.app, markdown, container, sourcePath, this);
    } catch (e) {
      console.error("Day Won: Leaflet markdown render failed", e);
      container.createDiv("day-won-leaflet-error").setText(
        "Map could not be rendered. Install and enable the Leaflet community plugin."
      );
    }
  }

  private yearsAgo(d: Date): string {
    const now = new Date();
    const diff = now.getFullYear() - d.getFullYear();
    if (diff <= 0) return "";
    if (diff === 1) return "1 Year Ago";
    return `${diff} Years Ago`;
  }

  private getJournalColor(journalName: string): string {
    const configs = this.plugin.settings.journalConfigs ?? {};
    return configs[journalName]?.color ?? getDefaultJournalColor(journalName);
  }

  private getEntryTypeIcon(typeName: string | null): string {
    if (!typeName) return "file-text";
    const t = (this.plugin.settings.entryTypes ?? []).find(
      (e) => e.name.trim().toLowerCase() === typeName.trim().toLowerCase()
    );
    return t?.icon?.trim() || "file-text";
  }

  private navigateTo(dateKey: string) {
    this.setState({ ...this.state, dateKey });
  }
}

class DayDetailModal extends Modal {
  constructor(
    app: import("obsidian").App,
    private dateKey: string,
    private entries: JournalEntry[],
    private onSelectEntry: (e: JournalEntry) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("day-won-modal-content");
    contentEl.createEl("h2", { text: formatDate(this.dateKey, "full") });
    for (const entry of this.entries) {
      const row = contentEl.createDiv("day-won-modal-entry");
      if (entry.time) row.createSpan("day-won-modal-time").setText(entry.time.slice(0, 5));
      row.createDiv("day-won-modal-preview").setText(entry.name);
      if (entry.firstImagePath) {
        const thumb = row.createDiv("day-won-modal-thumb");
        const img = document.createElement("img");
        img.src = this.getImageUrl(entry.firstImagePath);
        img.alt = "";
        thumb.appendChild(img);
      }
      row.addEventListener("click", () => {
        this.onSelectEntry(entry);
        this.close();
      });
    }
  }

  private getImageUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return this.app.vault.getResourcePath(file);
    for (const ext of ["", ".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
      const f = this.app.vault.getAbstractFileByPath(path + ext);
      if (f instanceof TFile) return this.app.vault.getResourcePath(f);
    }
    const filename = path.includes("/") ? path.split("/").pop()! : path;
    const found = this.app.vault.getFiles().find((f) => f.name === filename);
    if (found) return this.app.vault.getResourcePath(found);
    return this.app.vault.adapter.getResourcePath(path);
  }
}
