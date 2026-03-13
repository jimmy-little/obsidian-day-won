#!/usr/bin/env node
/**
 * Release script: bump patch version, build, tag, push, and create GitHub release
 * with Obsidian plugin assets (manifest.json, main.js, styles.css, versions.json).
 *
 * Prerequisites: gh CLI (brew install gh), clean working tree, and gh auth login.
 */

import { readFileSync, writeFileSync } from "fs";
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

// 5. Git: add, commit, tag
const tag = `v${newVersion}`;
run(`git add ${MANIFEST_PATH} ${VERSIONS_PATH} ${PACKAGE_PATH}`);
run(`git commit -m "Release ${tag}"`);
run(`git tag ${tag}`);

// 6. Push branch and tags
console.log("Pushing to origin...");
run("git push");
run("git push origin --tags");

// 7. Create GitHub release and attach Obsidian plugin files
console.log(`Creating release ${tag}...`);
execFileSync("gh", [
  "release",
  "create",
  tag,
  ...ASSETS,
  "--title",
  tag,
  "--notes",
  `Release ${tag}`,
], { stdio: "inherit" });

console.log(`Done. Release ${tag} is live.`);
