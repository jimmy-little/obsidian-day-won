#!/usr/bin/env node
/**
 * Release script: bump patch version, build, tag, push, and create GitHub release
 * with Obsidian plugin assets (manifest.json, main.js, styles.css, versions.json)
 * plus a single plugin zip (some installers/BRAT on mobile may use the zip instead of Source code).
 *
 * Prerequisites: gh CLI (brew install gh), clean working tree, and gh auth login.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { execSync, execFileSync } from "child_process";

const MANIFEST_PATH = "manifest.json";
const VERSIONS_PATH = "versions.json";
const PACKAGE_PATH = "package.json";
const ASSETS = ["manifest.json", "main.js", "styles.css", "versions.json"];

function bumpPatch(version) {
  const parts = version.split(".").map(Number);
  if (parts.length < 3) parts.push(0);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join(".");
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

// 1. Bump version in manifest (0.0.{one more} = patch)
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const oldVersion = manifest.version;
const newVersion = bumpPatch(oldVersion);

manifest.version = newVersion;
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, "\t"));
console.log(`Bumped version: ${oldVersion} → ${newVersion}`);

// 2. Update versions.json (Obsidian compatibility)
const versions = JSON.parse(readFileSync(VERSIONS_PATH, "utf8"));
versions[newVersion] = manifest.minAppVersion;
writeFileSync(VERSIONS_PATH, JSON.stringify(versions, null, "\t"));

// 3. Sync package.json version
const pkg = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
pkg.version = newVersion;
writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2));

// 4. Build production bundle
console.log("Building...");
run("npm run build");

// 5. Git: add, commit, tag (tag = raw version for BRAT: it looks up release by manifest version, no "v" prefix)
const tag = newVersion;
run(`git add ${MANIFEST_PATH} ${VERSIONS_PATH} ${PACKAGE_PATH}`);
run(`git commit -m "Release ${tag}"`);
run(`git tag ${tag}`);

// 6. Push branch and tags
console.log("Pushing to origin...");
run("git push");
run("git push origin --tags");

// 7. Create a single plugin zip (root contains main.js, manifest.json, styles.css, versions.json)
//    so installers that prefer one zip (e.g. BRAT on mobile) get the built files, not Source code.
const zipName = `day-won-${tag}.zip`;
try {
  execSync(`zip -j ${zipName} ${ASSETS.join(" ")}`, { stdio: "inherit" });
} catch (e) {
  console.warn("zip command failed (optional); release will still have individual assets.", e.message);
}

// 8. Create GitHub release and attach Obsidian plugin files + plugin zip
console.log(`Creating release ${tag}...`);
const releaseAssets = existsSync(zipName) ? [...ASSETS, zipName] : ASSETS;
execFileSync("gh", [
  "release",
  "create",
  tag,
  ...releaseAssets,
  "--title",
  tag,
  "--notes",
  `Release ${tag}`,
], { stdio: "inherit" });

if (existsSync(zipName)) {
  try { unlinkSync(zipName); } catch (_) {}
}

console.log(`Done. Release ${tag} is live.`);
console.log("BRAT: install by picking a version from the list (tag matches manifest version).");
