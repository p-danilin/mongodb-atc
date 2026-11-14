#!/usr/bin/env bash
# Launches the MongoDB MCP server for Claude Code (.mcp.json).
# GUI apps don't load your shell profile, so load credentials here.
# Put `export MDB_MCP_CONNECTION_STRING="mongodb+srv://..."` in ~/.mcp-env (chmod 600).
[ -f "$HOME/.mcp-env" ] && . "$HOME/.mcp-env"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
exec npx -y 'mongodb-mcp-server@<4' "$@"
