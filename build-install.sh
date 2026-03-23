#!/usr/bin/env bash
# Build the plugin and link it into the Obsidian vault.
set -e
cd "$(dirname "$0")"
npm run build
npm run link-vault
echo "Done. Enable 'Day, Won' in Obsidian if needed."
