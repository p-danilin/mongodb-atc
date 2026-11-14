#!/usr/bin/env bash
# Launches the MongoDB MCP server for Claude Code (.mcp.json).
# GUI apps don't load your shell profile, so load credentials here from either:
#   - <repo>/.env      (gitignored; MONGODB_URI or MDB_MCP_CONNECTION_STRING)
#   - ~/.mcp-env       (export MDB_MCP_CONNECTION_STRING="mongodb+srv://...")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$HOME/.mcp-env" ] && . "$HOME/.mcp-env"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
export MDB_MCP_CONNECTION_STRING="${MDB_MCP_CONNECTION_STRING:-$MONGODB_URI}"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
exec npx -y 'mongodb-mcp-server@<4' "$@"
