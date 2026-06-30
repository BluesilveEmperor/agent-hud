#!/usr/bin/env bash
# Wrap `opencode` so AGENT HUD can show its working/done state.
# Usage:  opencode-wrap.sh <args...>    (alias this to `opencode` if you like)
export LIGHT_AGENT=opencode
export LIGHT_WRAP_BIN="${OPENCODE_BIN:-opencode}"
exec node "$(dirname "$0")/agent-wrap.mjs" "$@"
