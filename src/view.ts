import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  Modal,
  setIcon,
} from "obsidian";
import type DayWonPlugin from "./main";
import {
  type JournalEntry,
  type EntryTypeKind,
  getJournalEntries,
  groupEntriesByDate,
  groupEntriesByJournal,
  computeStreak,
  onThisDayCount,
  parseFolderList,
  getDefaultJournalColor,
} from "./journal";

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
    return "book-open";
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

  /** Resolve image path to a URL (exact path, then by filename anywhere in vault, then adapter). */
  private getImageUrl(path: string): string {
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
        {
          workout: s.entryTypeWorkout ?? { mode: "", value: "" },
          location: s.entryTypeLocation ?? { mode: "", value: "" },
          trip: s.entryTypeTrip ?? { mode: "", value: "" },
        }
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
    const onThisDay = onThisDayCount(entries, now.getMonth() + 1, now.getDate());

    const stats = container.createDiv("day-won-stats");
    const items = [
      { label: "STREAK", value: `${streak} Days` },
      { label: "ENTRIES", value: String(this.entries.length) },
      { label: "MEDIA", value: String(mediaCount) },
      { label: "DAYS", value: String(uniqueDays) },
      { label: "ON THIS DAY", value: String(onThisDay) },
    ];
    for (const { label, value } of items) {
      const block = stats.createDiv("day-won-stat");
      block.createEl("div", "day-won-stat-label").setText(label);
      block.createEl("div", "day-won-stat-value").setText(value);
    }
  }

  private renderList(container: HTMLElement, entries: JournalEntry[]) {
    const byJournal = groupEntriesByJournal(entries);
    const journalNames = [...byJournal.keys()].sort();

    const listEl = container.createDiv("day-won-list");
    for (const journalName of journalNames) {
      const journalEntries = byJournal.get(journalName) ?? [];
      const section = listEl.createDiv("day-won-list-journal-section");
      section.createEl("h2", "day-won-list-journal-title").setText(journalName);

      let lastYear = "";
      let lastMonth = "";
      let lastDate = "";
      for (const entry of journalEntries) {
        const [y, m] = entry.date.split("-");
        const year = y;
        const monthKey = `${y}-${m}`;
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
          const dayLabel = formatDate(entry.date, "dayFull");
          section.createDiv("day-won-list-day-header").setText(dayLabel);
        }
        const row = section.createDiv("day-won-list-entry");
        const time = entry.time ? entry.time.slice(0, 5) : "";
        if (time) row.createSpan("day-won-list-time").setText(time);
        const content = row.createDiv("day-won-list-content");
        content.createDiv("day-won-list-preview").setText(entry.name);
        if (entry.firstImagePath) {
          const imgWrap = content.createDiv("day-won-list-thumb");
          const img = document.createElement("img");
          img.src = this.getImageUrl(entry.firstImagePath);
          img.alt = "";
          img.loading = "lazy";
          imgWrap.appendChild(img);
        }
        row.addEventListener("click", () => this.openEntry(entry));
      }
    }
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

    if (isAllView) {
      if (dayEntries.length > 0) {
        const num = document.createElement("div");
        num.className = "day-won-calendar-day-num";
        num.textContent = String(dayNum);
        cell.appendChild(num);
        const dots = document.createElement("div");
        dots.className = "day-won-calendar-day-dots";
        for (const e of dayEntries) {
          const dot = document.createElement("span");
          dot.className = "day-won-calendar-dot";
          dot.style.backgroundColor = this.getJournalColor(e.journal || "Default");
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
    } else {
      const bgEntry = dayEntries.find((e) => e.firstImagePath) ?? dayEntries[0];
      if (bgEntry?.firstImagePath) {
        cell.style.backgroundImage = `url(${this.getImageUrl(bgEntry.firstImagePath)})`;
        cell.style.backgroundSize = "cover";
        cell.style.backgroundPosition = "center";
      } else if (this.selectedJournal && dayEntries.length > 0) {
        cell.style.borderColor = this.getJournalColor(this.selectedJournal);
        cell.style.borderWidth = "2px";
      }
      const num = document.createElement("div");
      num.className = "day-won-calendar-day-num";
      num.textContent = String(dayNum);
      cell.appendChild(num);
      if (dayEntries.length > 0) {
        const dots = document.createElement("div");
        dots.className = "day-won-calendar-day-dots";
        const color = this.getJournalColor(
          this.selectedJournal || dayEntries[0].journal || "Default"
        );
        for (let i = 0; i < dayEntries.length; i++) {
          const dot = document.createElement("span");
          dot.className = "day-won-calendar-dot";
          dot.style.backgroundColor = color;
          dots.appendChild(dot);
        }
        cell.appendChild(dots);
        cell.classList.add("has-entries");
        cell.addEventListener("click", () => this.openDay(dateKey, dayEntries));
      }
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
        {
          workout: s.entryTypeWorkout ?? { mode: "", value: "" },
          location: s.entryTypeLocation ?? { mode: "", value: "" },
          trip: s.entryTypeTrip ?? { mode: "", value: "" },
        }
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

    const cardGrid = body.createDiv("day-won-day-card-grid");
    for (const entry of this.entries) {
      const card = cardGrid.createDiv("day-won-day-card");
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
      if (entry.entryType) {
        const iconWrap = row.createDiv("day-won-day-card-icon-wrap");
        iconWrap.addClass(`day-won-day-type-${entry.entryType}`);
        setIcon(iconWrap.createSpan("day-won-day-card-icon"), this.entryTypeIcon(entry.entryType));
      }
      const textWrap = row.createDiv("day-won-day-card-text");
      if (entry.time && entry.time.trim()) {
        const timeStr = entry.time.trim().slice(0, 5);
        if (timeStr) textWrap.createEl("div", "day-won-day-card-time").setText(timeStr);
      }
      textWrap.createEl("div", "day-won-day-card-name").setText(entry.name);

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

  private yearsAgo(d: Date): string {
    const now = new Date();
    const diff = now.getFullYear() - d.getFullYear();
    if (diff <= 0) return "";
    if (diff === 1) return "1 Year Ago";
    return `${diff} Years Ago`;
  }

  private entryTypeIcon(kind: EntryTypeKind): string {
    switch (kind) {
      case "workout":
        return "dumbbell";
      case "location":
        return "map-pin";
      case "trip":
        return "car";
      default:
        return "file-text";
    }
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
