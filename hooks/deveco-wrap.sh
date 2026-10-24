#!/usr/bin/env bash
# Wrap `deveco-code` so AGENT HUD can show its working/done state.
# Usage:  deveco-wrap.sh <args...>    (alias this to `deveco-code` if you like)
export LIGHT_AGENT=deveco-code
export LIGHT_WRAP_BIN="${DEVECO_BIN:-deveco-code}"
exec node "$(dirname "$0")/agent-wrap.mjs" "$@"
