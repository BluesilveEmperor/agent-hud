@echo off
REM Wrap `opencode` so AGENT HUD can show its working/done state.
REM Usage:  opencode-wrap.cmd <args...>    (alias this to `opencode` if you like)
set LIGHT_AGENT=opencode
set LIGHT_WRAP_BIN=opencode
node "%~dp0agent-wrap.mjs" %*
