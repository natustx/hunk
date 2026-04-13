#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"

# Sync to the tracked fork branch on updates
if [ -d .git ]; then
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || true)
    if [ -n "$CURRENT_BRANCH" ] && git remote get-url origin &>/dev/null; then
        git fetch origin
        if git show-ref --verify --quiet "refs/remotes/origin/$CURRENT_BRANCH"; then
            git reset --hard "origin/$CURRENT_BRANCH"
        fi
    fi
fi

TOOL_NAME=hunk
INSTALL_DIR="$HOME/prj/util/bin"

rm -f "dist/$TOOL_NAME" "$INSTALL_DIR/$TOOL_NAME"
rm -rf dist .bun-install .bun-tmp

bun install --frozen-lockfile
HUNK_INSTALL_DIR="$INSTALL_DIR" bun run install:bin

chmod +x "$INSTALL_DIR/$TOOL_NAME"
echo "Installed: $($INSTALL_DIR/$TOOL_NAME --version 2>/dev/null || echo $TOOL_NAME)"
