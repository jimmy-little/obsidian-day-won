#!/usr/bin/env node
/**
 * Build the plugin, create a zip of built files, and upload it to an EXISTING
 * GitHub release. Use this to add day-won-<version>.zip to a release that
 * was created without it (e.g. so BRAT might use this zip instead of Source code).
 *
 * Usage: node upload-plugin-zip-to-release.mjs <version>
 * Example: node upload-plugin-zip-to-release.mjs 0.0.3
 *
 * Prerequisites: npm run build (or we run it), zip, gh CLI, gh auth login.
 */

import { existsSync, unlinkSync } from "fs";
import { execSync, execFileSync } from "child_process";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node upload-plugin-zip-to-release.mjs <version>");
  console.error("Example: node upload-plugin-zip-to-release.mjs 0.0.3");
  process.exit(1);
}

const ASSETS = ["manifest.json", "main.js", "styles.css", "versions.json"];
const zipName = `day-won-${version}.zip`;

for (const f of ASSETS) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Run 'npm run build' first.`);
    process.exit(1);
  }
}

console.log("Building...");
execSync("npm run build", { stdio: "inherit" });

console.log(`Creating ${zipName}...`);
execSync(`zip -j ${zipName} ${ASSETS.join(" ")}`, { stdio: "inherit" });

console.log(`Uploading to release ${version}...`);
execFileSync("gh", ["release", "upload", version, zipName, "--clobber"], { stdio: "inherit" });

unlinkSync(zipName);
console.log(`Done. Release ${version} now has ${zipName}. Try BRAT again.`);
