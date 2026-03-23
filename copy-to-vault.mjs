#!/usr/bin/env node
/**
 * Copy the built plugin files into your iCloud vault's plugin folder.
 * Use this so the plugin syncs to your phone via iCloud (BRAT-free).
 *
 * Unlike link-vault, this copies real files (no symlink), so iCloud syncs
 * them and Obsidian on mobile can load the plugin. Run after building.
 *
 * Usage: npm run build && node copy-to-vault.mjs
 * Or: npm run build && npm run copy-to-vault
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT_PLUGINS = path.join(
  process.env.HOME || "",
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/JimmyOS/.obsidian/plugins"
);
const PLUGIN_ID = "day-won";
const TARGET_DIR = path.join(VAULT_PLUGINS, PLUGIN_ID);
const REQUIRED_FILES = ["main.js", "manifest.json", "styles.css", "versions.json"];
const SETTINGS_FILE = "data.json"; // optional: copied when vault was symlinked so settings lived in repo

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  const vaultDir = path.dirname(VAULT_PLUGINS);
  if (!fs.existsSync(vaultDir)) {
    console.error("Vault not found at:", path.dirname(VAULT_PLUGINS));
    console.error("Edit VAULT_PLUGINS in copy-to-vault.mjs to match your iCloud vault path.");
    process.exit(1);
  }

  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(__dirname, f))) {
      console.error("Missing", f, "- run 'npm run build' first.");
      process.exit(1);
    }
  }

  if (fs.existsSync(TARGET_DIR)) {
    const stat = fs.lstatSync(TARGET_DIR);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(TARGET_DIR);
      console.log("Removed existing symlink at", TARGET_DIR);
    }
  }

  ensureDir(TARGET_DIR);

  for (const f of REQUIRED_FILES) {
    const src = path.join(__dirname, f);
    const dest = path.join(TARGET_DIR, f);
    fs.copyFileSync(src, dest);
    console.log("Copied", f);
  }

  const dataSrc = path.join(__dirname, SETTINGS_FILE);
  if (fs.existsSync(dataSrc)) {
    fs.copyFileSync(dataSrc, path.join(TARGET_DIR, SETTINGS_FILE));
    console.log("Copied", SETTINGS_FILE, "(your settings from symlinked setup)");
  }

  console.log("\nPlugin copied to vault:");
  console.log(" ", TARGET_DIR);
  console.log("\niCloud will sync this folder to your phone.");
  console.log("On the phone: open the vault in Obsidian → Settings → Community plugins → enable 'Day, Won!'");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
