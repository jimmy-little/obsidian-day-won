#!/usr/bin/env node
/**
 * Symlinks this plugin into the Obsidian vault's .obsidian/plugins folder
 * so you can develop and test in the app. Run: npm run link-vault
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAULT_PLUGINS = path.join(
  process.env.HOME || "",
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/JimmyOS/.obsidian/plugins"
);
const PLUGIN_NAME = "day-won";
const TARGET = path.join(VAULT_PLUGINS, PLUGIN_NAME);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  const vaultDir = path.dirname(VAULT_PLUGINS);
  if (!fs.existsSync(vaultDir)) {
    console.error("Vault not found at:", path.join(vaultDir, ".obsidian"));
    console.error("Ensure the vault path in link-vault.mjs matches your setup.");
    process.exit(1);
  }

  ensureDir(VAULT_PLUGINS);

  if (fs.existsSync(TARGET)) {
    const stat = fs.lstatSync(TARGET);
    if (stat.isSymbolicLink()) {
      const resolved = fs.realpathSync(TARGET);
      const dirnameReal = fs.realpathSync(__dirname);
      if (resolved === dirnameReal) {
        console.log("Plugin already linked to vault at:", TARGET);
        return;
      }
      fs.unlinkSync(TARGET);
    } else {
      console.error("Target exists and is not a symlink:", TARGET);
      console.error("Remove or rename it, then run again.");
      process.exit(1);
    }
  }

  try {
    fs.symlinkSync(__dirname, TARGET, "dir");
  } catch (err) {
    if (err.code === "EEXIST") {
      fs.unlinkSync(TARGET);
      fs.symlinkSync(__dirname, TARGET, "dir");
    } else {
      throw err;
    }
  }
  console.log("Linked plugin to vault:");
  console.log("  ", __dirname, "->", TARGET);
  console.log("\nBuild with: npm run dev (watch) or npm run build");
  console.log("Then enable 'Day Won' in Obsidian Settings → Community plugins.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
