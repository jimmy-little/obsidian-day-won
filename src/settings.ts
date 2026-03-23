import { App, Modal, PluginSettingTab, Setting, setIcon } from "obsidian";
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

/** One user-defined entry type: name, path/frontmatter rule, and icon. Order in array = priority. */
export interface UserEntryType {
  id?: string;
  name: string;
  mode: "" | "path" | "frontmatter";
  value: string;
  icon: string;
}

export interface DayWonSettings {
  /** Folder paths (vault-relative) to scan. One per line or comma-separated. Empty = whole vault. */
  journalFolders: string;
  /** @deprecated Use journalFolders. Kept for migration. */
  journalFolder?: string;
  /** Per-journal header color and display toggle. Populated when user clicks Update. */
  journalConfigs: Record<string, JournalConfig>;
  /** User-defined entry types. Order = priority (first match wins). */
  entryTypes: UserEntryType[];
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
  /** Frontmatter key for time-tracking entries. If this key exists and has a value, entry shows the timer icon (any value counts). */
  lapseEntriesProperty: string;
  /** Default folder path for new journal entries created via the + button. Supports moment-style date variables: {YYYY}, {MM}, {DD}, {HH}, {mm}, {ss}, {MMMM}, {MMM}, {dddd}, {ddd}. */
  defaultJournalEntryLocation: string;
  /** Where to store images attached to new entries: "subfolder" = create a subfolder next to the note; "assets" = use the path below. */
  attachmentMode: "subfolder" | "assets";
  /** When attachment mode is "assets", folder path for attached images. Supports moment-style date variables. */
  assetsFolderPath: string;
  /** Show an aggregated Leaflet map on the day view when entries have lat/long (requires Leaflet community plugin). */
  useLeafletMaps: boolean;
  /** Frontmatter key for latitude on check-in notes (Leaflet day map). */
  leafletLatProperty: string;
  /** Frontmatter key for longitude on check-in notes. Also reads `lng` / `longitude` when this is `long`. */
  leafletLongProperty: string;
}

const DEFAULT_ENTRY_TYPES: UserEntryType[] = [
  { name: "Workout", mode: "", value: "", icon: "dumbbell" },
  { name: "Location", mode: "", value: "", icon: "map-pin" },
  { name: "Trip", mode: "", value: "", icon: "car" },
];

export const DEFAULT_SETTINGS: DayWonSettings = {
  journalFolders: "Journal",
  journalConfigs: {},
  entryTypes: [...DEFAULT_ENTRY_TYPES],
  dateProperty: "date",
  timeProperty: "time",
  entryProperty: "entry",
  journalProperty: "journal",
  journalName: "Life",
  lapseEntriesProperty: "lapseEntries",
  defaultJournalEntryLocation: "Journal/{YYYY}/{MM}-{MMMM}",
  attachmentMode: "subfolder",
  assetsFolderPath: "Assets/{YYYY}/{MM}-{MMMM}",
  useLeafletMaps: false,
  leafletLatProperty: "lat",
  leafletLongProperty: "long",
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

    containerEl.createEl("h3", { text: "Entry types" }).addClass("day-won-settings-journals-heading");
    containerEl.createEl("p", { text: "Define types (e.g. workout, meeting). Order = priority: first matching type wins. Path or frontmatter rules classify notes; set an icon for list and day view." }).addClass("day-won-settings-desc");
    const entryTypes = this.plugin.settings.entryTypes ?? [];
    const entryListWrap = containerEl.createDiv("day-won-settings-entry-types-list");
    for (let i = 0; i < entryTypes.length; i++) {
      const t = entryTypes[i];
      const row = entryListWrap.createDiv("day-won-settings-entry-type-row");
      const dragHandle = row.createSpan("day-won-settings-entry-type-drag");
      setIcon(dragHandle, "grip-vertical");
      const nameInp = row.createEl("input", { type: "text", cls: "day-won-settings-entry-type-name" });
      nameInp.placeholder = "Name (e.g. Workout)";
      nameInp.value = t.name;
      nameInp.onchange = async () => {
        t.name = nameInp.value.trim() || t.name;
        await this.plugin.saveSettings();
      };
      const modeSel = row.createEl("select", { cls: "day-won-settings-entry-type-mode" });
      modeSel.innerHTML = '<option value="">Off</option><option value="path">Path</option><option value="frontmatter">Frontmatter</option>';
      modeSel.value = t.mode;
      modeSel.onchange = async () => {
        t.mode = modeSel.value as "" | "path" | "frontmatter";
        await this.plugin.saveSettings();
        this.display();
      };
      const valueInp = row.createEl("input", { type: "text", cls: "day-won-settings-entry-type-value" });
      valueInp.placeholder = t.mode === "frontmatter" ? 'type: "[[Trip]]"' : "Journal/Workouts/{YYYY}";
      valueInp.value = t.value;
      valueInp.onchange = async () => {
        t.value = (valueInp.value ?? "").trim();
        await this.plugin.saveSettings();
      };
      const iconWrap = row.createDiv("day-won-settings-entry-type-icon-wrap");
      const iconSpan = iconWrap.createSpan("day-won-settings-entry-type-icon-preview");
      setIcon(iconSpan, (t.icon || "file-text") as "file-text");
      const iconBtn = iconWrap.createEl("button", { type: "button", cls: "day-won-settings-entry-type-icon-btn" });
      iconBtn.setText(t.icon || "file-text");
      iconBtn.onclick = async () => {
        const picker = new IconPickerModal(this.app, t.icon || "file-text", (icon) => {
          t.icon = icon;
          this.plugin.saveSettings();
          this.display();
        });
        picker.open();
      };
      const moveUp = row.createEl("button", { type: "button", cls: "day-won-settings-entry-type-move" });
      setIcon(moveUp, "chevron-up");
      moveUp.title = "Move up (higher priority)";
      if (i === 0) moveUp.setAttribute("disabled", "true");
      moveUp.onclick = async () => {
        if (i === 0) return;
        const arr = [...entryTypes];
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        this.plugin.settings.entryTypes = arr;
        await this.plugin.saveSettings();
        this.display();
      };
      const moveDown = row.createEl("button", { type: "button", cls: "day-won-settings-entry-type-move" });
      setIcon(moveDown, "chevron-down");
      moveDown.title = "Move down (lower priority)";
      if (i === entryTypes.length - 1) moveDown.setAttribute("disabled", "true");
      moveDown.onclick = async () => {
        if (i >= entryTypes.length - 1) return;
        const arr = [...entryTypes];
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        this.plugin.settings.entryTypes = arr;
        await this.plugin.saveSettings();
        this.display();
      };
      const removeBtn = row.createEl("button", { type: "button", cls: "day-won-settings-entry-type-remove" });
      setIcon(removeBtn, "trash-2");
      removeBtn.title = "Remove";
      removeBtn.onclick = async () => {
        this.plugin.settings.entryTypes = entryTypes.filter((_, j) => j !== i);
        await this.plugin.saveSettings();
        this.display();
      };
    }
    const addRow = containerEl.createDiv("day-won-settings-entry-types-actions");
    new Setting(addRow)
      .addButton((btn) =>
        btn.setButtonText("Add entry type").onClick(async () => {
          const list = this.plugin.settings.entryTypes ?? [];
          list.push({ name: "New type", mode: "", value: "", icon: "file-text" });
          this.plugin.settings.entryTypes = list;
          await this.plugin.saveSettings();
          this.display();
        })
      );

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
      .setName("Time-tracking property (optional)")
      .setDesc("Frontmatter key for time-tracking entries (e.g. lapseEntries). If this key exists and has any value, the entry shows the timer icon. Leave empty to disable.")
      .addText((text) =>
        text
          .setPlaceholder("lapseEntries")
          .setValue(this.plugin.settings.lapseEntriesProperty ?? "lapseEntries")
          .onChange(async (value) => {
            this.plugin.settings.lapseEntriesProperty = (value ?? "").trim();
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

    containerEl.createEl("h3", { text: "Day view map (Leaflet)" }).addClass("day-won-settings-journals-heading");
    new Setting(containerEl)
      .setName("Use Leaflet maps")
      .setDesc(
        "On the day page, show one map with a marker per entry that has latitude/longitude in frontmatter. Requires the Leaflet community plugin to be installed and enabled."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.useLeafletMaps ?? false).onChange(async (value) => {
          this.plugin.settings.useLeafletMaps = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    if (this.plugin.settings.useLeafletMaps) {
      new Setting(containerEl)
        .setName("Latitude property")
        .setDesc("Frontmatter key for latitude (e.g. lat).")
        .addText((text) =>
          text
            .setPlaceholder("lat")
            .setValue(this.plugin.settings.leafletLatProperty ?? "lat")
            .onChange(async (value) => {
              this.plugin.settings.leafletLatProperty = (value || "lat").trim();
              await this.plugin.saveSettings();
            })
        );
      new Setting(containerEl)
        .setName("Longitude property")
        .setDesc("Frontmatter key for longitude (e.g. long). If set to long, lng and longitude are also read.")
        .addText((text) =>
          text
            .setPlaceholder("long")
            .setValue(this.plugin.settings.leafletLongProperty ?? "long")
            .onChange(async (value) => {
              this.plugin.settings.leafletLongProperty = (value || "long").trim();
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Default journal entry location")
      .setDesc("Folder path for new entries created via the + button. Use date variables: {YYYY}, {MM}, {DD}, {HH}, {mm}, {MMMM}, {MMM}, {dddd}, {ddd}. Example: Journal/{YYYY}/{MM}-{MMMM}")
      .addText((text) =>
        text
          .setPlaceholder("Journal/{YYYY}/{MM}-{MMMM}")
          .setValue(this.plugin.settings.defaultJournalEntryLocation ?? "Journal/{YYYY}/{MM}-{MMMM}")
          .onChange(async (value) => {
            this.plugin.settings.defaultJournalEntryLocation = (value ?? "").trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Attachments" }).addClass("day-won-settings-journals-heading");
    new Setting(containerEl)
      .setName("Attachment location")
      .setDesc("Where to save images added when creating a new entry.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("subfolder", "Create subfolder for entry")
          .addOption("assets", "Keep in Assets folder")
          .setValue(this.plugin.settings.attachmentMode ?? "subfolder")
          .onChange(async (value) => {
            this.plugin.settings.attachmentMode = value as "subfolder" | "assets";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.attachmentMode === "assets") {
      new Setting(containerEl)
        .setName("Assets folder path")
        .setDesc("Folder for attached images when using \"Keep in Assets folder\". Use date variables: {YYYY}, {MM}, {DD}, {MMMM}, {MMM}, etc.")
        .addText((text) =>
          text
            .setPlaceholder("Assets/{YYYY}/{MM}-{MMMM}")
            .setValue(this.plugin.settings.assetsFolderPath ?? "Assets/{YYYY}/{MM}-{MMMM}")
            .onChange(async (value) => {
              this.plugin.settings.assetsFolderPath = (value ?? "").trim();
              await this.plugin.saveSettings();
            })
        );
    }
  }
}

/** Lucide icon names for the icon picker. User can also type any name in search and use "Use search as icon name". */
const LUCIDE_ICONS = [
  "activity", "airplay", "alarm-clock", "anchor", "aperture", "archive", "atom", "award",
  "bar-chart", "bar-chart-2", "bar-chart-3", "bar-chart-horizontal", "battery", "battery-charging",
  "bell", "bike", "book", "book-open", "bookmark", "briefcase", "brush", "building", "building-2",
  "calendar", "camera", "car", "chart-bar", "chart-line", "chart-pie", "check", "check-circle",
  "chevron-down", "chevron-right", "clipboard", "clock", "cloud", "coffee", "compass",
  "credit-card", "crosshair", "cup", "database", "dollar-sign", "download", "dumbbell",
  "edit", "edit-2", "edit-3", "external-link", "eye", "film", "file", "file-text", "filter",
  "flag", "folder", "gift", "globe", "grape", "grid", "heart", "home", "image", "inbox",
  "info", "key", "laptop", "layers", "layout-dashboard", "lightbulb", "link", "list",
  "mail", "map", "map-pin", "maximize", "message-circle", "mic", "minus", "moon", "music",
  "navigation", "package", "pencil", "phone", "pie-chart", "plane", "play", "plus",
  "puzzle", "quote", "repeat", "run", "save", "scissors", "search", "send", "settings",
  "shopping-bag", "shopping-cart", "shield", "smile", "sparkles", "square", "star",
  "sun", "target", "terminal", "timer", "trending-up", "trending-down", "trophy",
  "tv", "umbrella", "upload", "user", "users", "users-2", "utensils", "video", "wallet",
  "wine", "workflow", "x", "zap",
];

class IconPickerModal extends Modal {
  private selected: string;
  private onChoose: (icon: string) => void;

  constructor(app: App, initial: string, onChoose: (icon: string) => void) {
    super(app);
    this.selected = initial || "file-text";
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Choose icon" });
    const searchEl = contentEl.createEl("input", { type: "text", cls: "day-won-icon-picker-search" });
    searchEl.placeholder = "Search icons...";
    searchEl.value = this.selected;
    const grid = contentEl.createDiv("day-won-icon-picker-grid");
    const render = (filter: string) => {
      grid.empty();
      const q = filter.trim().toLowerCase();
      const icons = q ? LUCIDE_ICONS.filter((n) => n.includes(q)) : LUCIDE_ICONS;
      for (const name of icons) {
        const cell = grid.createDiv("day-won-icon-picker-cell");
        if (name === this.selected) cell.addClass("is-selected");
        const span = cell.createSpan("day-won-icon-picker-icon");
        setIcon(span, name as any);
        cell.onclick = () => {
          this.selected = name;
          this.onChoose(name);
          this.close();
        };
      }
    };
    searchEl.oninput = () => render(searchEl.value);
    render(this.selected);
    const useCustom = contentEl.createEl("div", { cls: "day-won-icon-picker-custom" });
    const customBtn = useCustom.createEl("button", { type: "button", cls: "day-won-icon-picker-use-custom" });
    customBtn.setText("Use search as icon name");
    customBtn.onclick = () => {
      const name = searchEl.value.trim();
      if (name) {
        this.onChoose(name);
        this.close();
      }
    };
  }
}
