#!/usr/bin/env bash
# install.sh — Install copilot-brag-sheet extension
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/vidhartbhatia/copilot-brag-sheet/main/install.sh | bash
#   # or from cloned repo: ./install.sh

set -euo pipefail

REPO_URL="https://github.com/vidhartbhatia/copilot-brag-sheet.git"
EXT_NAME="copilot-brag-sheet"
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"
TARGET_DIR="$COPILOT_HOME/extensions/$EXT_NAME"

GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
ok() { echo -e "  ${GREEN}✅ $1${NC}"; }

echo -e "${BOLD}Installing $EXT_NAME...${NC}"
echo ""

# ── Checks ───────────────────────────────────────────────────────────────────
command -v git  &>/dev/null || { echo "Error: git required — install from https://git-scm.com/downloads" >&2; exit 1; }
command -v node &>/dev/null || { echo "Error: Node.js 18+ required — install from https://nodejs.org" >&2; exit 1; }

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || { echo "Error: Node.js 18+ required (found v$(node --version))" >&2; exit 1; }

# ── Install extension files ──────────────────────────────────────────────────
[ -d "$TARGET_DIR" ] && rm -rf "$TARGET_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd 2>/dev/null || echo "")

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/extension.mjs" ]; then
    mkdir -p "$TARGET_DIR/lib" "$TARGET_DIR/bin"
    cp "$SCRIPT_DIR/extension.mjs" "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/plugin.json" "$TARGET_DIR/"
    cp "$SCRIPT_DIR"/lib/*.mjs "$TARGET_DIR/lib/"
    cp "$SCRIPT_DIR"/bin/*.mjs "$TARGET_DIR/bin/"
else
    git clone --depth 1 --quiet "$REPO_URL" "$TARGET_DIR"
    rm -rf "$TARGET_DIR/.git" "$TARGET_DIR/.github" "$TARGET_DIR/test" \
           "$TARGET_DIR/docs" "$TARGET_DIR/AGENTS.md" "$TARGET_DIR/CONTRIBUTING.md" \
           "$TARGET_DIR/ROADMAP.md" "$TARGET_DIR/CODEOWNERS" "$TARGET_DIR/CHANGELOG.md" \
           "$TARGET_DIR/CODE_OF_CONDUCT.md" "$TARGET_DIR/SECURITY.md" \
           "$TARGET_DIR/install.sh" "$TARGET_DIR/install.ps1"
fi

ok "Extension installed to $TARGET_DIR"

# ── Run interactive setup if terminal available ──────────────────────────────
if [ -t 0 ] && [ -f "$TARGET_DIR/bin/setup.mjs" ]; then
    echo ""
    node "$TARGET_DIR/bin/setup.mjs"
else
    echo ""
    echo -e "${GREEN}${BOLD}🎉 Installed!${NC}"
    echo ""
    echo "  Next steps:"
    echo "    1. Run the setup wizard:  node $TARGET_DIR/bin/setup.mjs"
    echo "    2. Run /clear in Copilot CLI"
    echo "    3. Say 'brag' to save an accomplishment"
    echo ""
fi
