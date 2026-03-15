import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, DayWonSettings, DayWonSettingTab } from "./settings";
import { DayWonView, DayDetailView, VIEW_TYPE_DAY_WON, VIEW_TYPE_DAY_WON_DAY } from "./view";
import { parseFolderList } from "./journal";

/** Lucide icon for ribbon and view tab (open book). Use "book-open"; rebuild and restart Obsidian if the icon doesn’t update. */
const PLUGIN_ICON = "book-open";

const REFRESH_DEBOUNCE_MS = 250;

export default class DayWonPlugin extends Plugin {
  settings: DayWonSettings = { ...DEFAULT_SETTINGS };
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_DAY_WON, (leaf) => new DayWonView(leaf, this));
    this.registerView(VIEW_TYPE_DAY_WON_DAY, (leaf) => new DayDetailView(leaf, this));

    this.addRibbonIcon(PLUGIN_ICON, "Open Day, Won! journal", () => this.activateView());

    this.addCommand({
      id: "open-day-won",
      name: "Open Day, Won! journal",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new DayWonSettingTab(this.app, this));

    this.app.metadataCache.on("changed", (file) => {
      if (file.extension !== "md") return;
      const folders = parseFolderList(
        this.settings.journalFolders ?? this.settings.journalFolder ?? ""
      );
      const inScope =
        folders.length === 0 ||
        folders.some(
          (f) => file.path === f || file.path.startsWith(f + "/")
        );
      if (!inScope) return;
      if (this.refreshTimeout != null) clearTimeout(this.refreshTimeout);
      this.refreshTimeout = setTimeout(() => {
        this.refreshTimeout = null;
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAY_WON)[0];
        const view = leaf?.view;
        if (view && view instanceof DayWonView) view.refresh();
        for (const dayLeaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DAY_WON_DAY)) {
          const dayView = dayLeaf?.view;
          if (dayView && dayView instanceof DayDetailView) dayView.refresh();
        }
      }, REFRESH_DEBOUNCE_MS);
    });
  }

  onunload() {
    if (this.refreshTimeout != null) clearTimeout(this.refreshTimeout);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_DAY_WON)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (right) await right.setViewState({ type: VIEW_TYPE_DAY_WON });
      leaf = workspace.getLeavesOfType(VIEW_TYPE_DAY_WON)[0];
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const raw = (await this.loadData()) as Partial<DayWonSettings> | null;
    if (raw) {
      if (raw.journalFolder != null && raw.journalFolders == null) {
        raw.journalFolders = raw.journalFolder;
      }
      if (raw.journalConfigs == null) raw.journalConfigs = {};
      if (raw.entryTypes == null || !Array.isArray(raw.entryTypes) || raw.entryTypes.length === 0) {
        raw.entryTypes = [
          { name: "Workout", mode: (raw as any).entryTypeWorkout?.mode ?? "", value: (raw as any).entryTypeWorkout?.value ?? "", icon: "dumbbell" },
          { name: "Location", mode: (raw as any).entryTypeLocation?.mode ?? "", value: (raw as any).entryTypeLocation?.value ?? "", icon: "map-pin" },
          { name: "Trip", mode: (raw as any).entryTypeTrip?.mode ?? "", value: (raw as any).entryTypeTrip?.value ?? "", icon: "car" },
        ];
      }
      if (raw.lapseEntriesProperty == null) raw.lapseEntriesProperty = "lapseEntries";
      if (raw.defaultJournalEntryLocation == null) raw.defaultJournalEntryLocation = DEFAULT_SETTINGS.defaultJournalEntryLocation;
      if (raw.attachmentMode == null) raw.attachmentMode = DEFAULT_SETTINGS.attachmentMode;
      if (raw.assetsFolderPath == null) raw.assetsFolderPath = DEFAULT_SETTINGS.assetsFolderPath;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
