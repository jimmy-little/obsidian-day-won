import { App, PluginSettingTab, Setting } from "obsidian";
import DayWonPlugin from "./main";
import {
  parseFolderList,
  getJournalNamesFromFolders,
  getDefaultJournalColor,
} from "./journal";

export interface JournalConfig {
  color: string;
  showInPicker: boolean;
}

/** Optional rule for one entry type: path(s) or frontmatter key:value(s). */
export interface EntryTypeRule {
  mode: "" | "path" | "frontmatter";
  value: string;
}

export type EntryTypeKind = "workout" | "location" | "trip";

export interface DayWonSettings {
  /** Folder paths (vault-relative) to scan. One per line or comma-separated. Empty = whole vault. */
  journalFolders: string;
  /** @deprecated Use journalFolders. Kept for migration. */
  journalFolder?: string;
  /** Per-journal header color and display toggle. Populated when user clicks Update. */
  journalConfigs: Record<string, JournalConfig>;
  /** Optional: Workout/Activity — path(s) or frontmatter key:value(s). Frontmatter wins over path if both match. */
  entryTypeWorkout: EntryTypeRule;
  /** Optional: Location/Checkin — path(s) or frontmatter key:value(s). */
  entryTypeLocation: EntryTypeRule;
  /** Optional: Trips/Commute — path(s) or frontmatter key:value(s). */
  entryTypeTrip: EntryTypeRule;
  /** Frontmatter key for the note's date (e.g. "date"). Expects YYYY-MM-DD or ISO string. */
  dateProperty: string;
  /** Optional frontmatter key for time (e.g. "time") for list ordering. */
  timeProperty: string;
  /** Frontmatter key for the entry display name in the list (e.g. "entry"). */
  entryProperty: string;
  /** Frontmatter key to group entries into sections (e.g. "journal"). Values like Life, Stats, Daily. */
  journalProperty: string;
  /** Journal title shown in the header (e.g. "Life") */
  journalName: string;
}

export const DEFAULT_SETTINGS: DayWonSettings = {
  journalFolders: "Journal",
  journalConfigs: {},
  entryTypeWorkout: { mode: "", value: "" },
  entryTypeLocation: { mode: "", value: "" },
  entryTypeTrip: { mode: "", value: "" },
  dateProperty: "date",
  timeProperty: "time",
  entryProperty: "entry",
  journalProperty: "journal",
  journalName: "Life",
};

export class DayWonSettingTab extends PluginSettingTab {
  plugin: DayWonPlugin;

  constructor(app: App, plugin: DayWonPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Journal folders")
      .setDesc("Vault-relative paths to scan. One per line or comma-separated (e.g. Journal, Daily). Notes with a date in frontmatter become entries. Leave empty to scan the whole vault.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Journal\nDaily")
          .setValue(this.plugin.settings.journalFolders ?? this.plugin.settings.journalFolder ?? "Journal")
          .onChange(async (value) => {
            this.plugin.settings.journalFolders = value?.trim() ?? "";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Update journal list")
      .setDesc("Scan the folders above and refresh the list of journals (with colors and picker visibility) below.")
      .addButton((btn) =>
        btn.setButtonText("Update").onClick(async () => {
          const folders = parseFolderList(
            this.plugin.settings.journalFolders ?? this.plugin.settings.journalFolder ?? ""
          );
          const folderList = folders.length > 0 ? folders : [];
          const names = getJournalNamesFromFolders(
            this.plugin.app.vault,
            this.plugin.app.metadataCache,
            folderList,
            this.plugin.settings.dateProperty,
            this.plugin.settings.journalProperty
          );
          const configs = this.plugin.settings.journalConfigs ?? {};
          for (const name of names) {
            if (!configs[name]) {
              configs[name] = {
                color: getDefaultJournalColor(name),
                showInPicker: true,
              };
            }
          }
          this.plugin.settings.journalConfigs = configs;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    const configs = this.plugin.settings.journalConfigs ?? {};
    const journalNames = Object.keys(configs).sort((a, b) => (a === "Default" ? 1 : a.localeCompare(b)));
    if (journalNames.length > 0) {
      containerEl.createEl("h3", { text: "Journals" }).addClass("day-won-settings-journals-heading");
      for (const name of journalNames) {
        const cfg = configs[name];
        const row = new Setting(containerEl)
          .setName(name)
          .setDesc("Header color and show in journal picker");
        row.addColorPicker((color) => {
          color.setValue(cfg.color).onChange(async (value) => {
            cfg.color = value;
            await this.plugin.saveSettings();
          });
        });
        row.addToggle((toggle) => {
          toggle.setValue(cfg.showInPicker).onChange(async (value) => {
            cfg.showInPicker = value;
            await this.plugin.saveSettings();
          });
        });
      }
    }

    containerEl.createEl("h3", { text: "Entry types (optional)" }).addClass("day-won-settings-journals-heading");
    const entryTypeLabels: { key: keyof DayWonSettings; label: string }[] = [
      { key: "entryTypeWorkout", label: "Workout / Activity" },
      { key: "entryTypeLocation", label: "Location / Check-in" },
      { key: "entryTypeTrip", label: "Trips / Commute" },
    ];
    for (const { key, label } of entryTypeLabels) {
      const rule = this.plugin.settings[key] as EntryTypeRule;
      if (!rule) continue;
      const row = new Setting(containerEl)
        .setName(label)
        .setDesc(
          rule.mode === "path"
            ? "Folder path(s), comma-separated. Notes under these paths are this type."
            : rule.mode === "frontmatter"
              ? 'Frontmatter key:value, comma-separated (e.g. type: "[[Trip]]"). Takes priority over path.'
              : "Choose Path or Frontmatter and fill the value. Leave off to ignore."
        );
      row.addDropdown((d) => {
        d.addOption("", "Off")
          .addOption("path", "Path")
          .addOption("frontmatter", "Frontmatter")
          .setValue(rule.mode)
          .onChange(async (v) => {
            rule.mode = v as "" | "path" | "frontmatter";
            await this.plugin.saveSettings();
            this.display();
          });
      });
      row.addText((t) =>
        t
          .setPlaceholder(rule.mode === "frontmatter" ? 'type: "[[Trip]]"' : "Journal/Workouts")
          .setValue(rule.value)
          .onChange(async (v) => {
            rule.value = (v ?? "").trim();
            await this.plugin.saveSettings();
          })
      );
    }

    new Setting(containerEl)
      .setName("Date property")
      .setDesc("Frontmatter key for the entry date (e.g. date). Use YYYY-MM-DD or full ISO date.")
      .addText((text) =>
        text
          .setPlaceholder("date")
          .setValue(this.plugin.settings.dateProperty)
          .onChange(async (value) => {
            this.plugin.settings.dateProperty = (value || "date").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Time property (optional)")
      .setDesc("Frontmatter key for time (e.g. time) for ordering entries on the same day.")
      .addText((text) =>
        text
          .setPlaceholder("time")
          .setValue(this.plugin.settings.timeProperty)
          .onChange(async (value) => {
            this.plugin.settings.timeProperty = (value || "").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Entry property (list title)")
      .setDesc("Frontmatter key for the entry name shown in the list (e.g. entry). Falls back to first line of note.")
      .addText((text) =>
        text
          .setPlaceholder("entry")
          .setValue(this.plugin.settings.entryProperty)
          .onChange(async (value) => {
            this.plugin.settings.entryProperty = (value || "entry").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Journal property (sections)")
      .setDesc("Frontmatter key to group entries into sections (e.g. journal). Values like Life, Stats, Daily.")
      .addText((text) =>
        text
          .setPlaceholder("journal")
          .setValue(this.plugin.settings.journalProperty)
          .onChange(async (value) => {
            this.plugin.settings.journalProperty = (value || "journal").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Journal name")
      .setDesc("Title shown in the journal header (e.g. Life).")
      .addText((text) =>
        text
          .setPlaceholder("Life")
          .setValue(this.plugin.settings.journalName)
          .onChange(async (value) => {
            this.plugin.settings.journalName = (value || "Life").trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
