import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, DayWonSettings, DayWonSettingTab, type EntryTypeRule } from "./settings";
import { DayWonView, DayDetailView, VIEW_TYPE_DAY_WON, VIEW_TYPE_DAY_WON_DAY } from "./view";
import { parseFolderList } from "./journal";

export default class DayWonPlugin extends Plugin {
  settings: DayWonSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_DAY_WON, (leaf) => new DayWonView(leaf, this));
    this.registerView(VIEW_TYPE_DAY_WON_DAY, (leaf) => new DayDetailView(leaf, this));

    this.addRibbonIcon("book-open", "Open Day, Won! journal", () => this.activateView());

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
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DAY_WON)[0];
      const view = leaf?.view;
      if (view && view instanceof DayWonView) view.refresh();
      for (const dayLeaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DAY_WON_DAY)) {
        const dayView = dayLeaf?.view;
        if (dayView && dayView instanceof DayDetailView) dayView.refresh();
      }
    });
  }

  onunload() {}

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
      const defaultRule: EntryTypeRule = { mode: "", value: "" };
      if (raw.entryTypeWorkout == null) raw.entryTypeWorkout = defaultRule;
      if (raw.entryTypeLocation == null) raw.entryTypeLocation = defaultRule;
      if (raw.entryTypeTrip == null) raw.entryTypeTrip = defaultRule;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
