@echo off
REM Wrap `deveco-code` so AGENT HUD can show its working/done state.
REM Usage:  deveco-wrap.cmd <args...>    (alias this to `deveco-code` if you like)
set LIGHT_AGENT=deveco-code
set LIGHT_WRAP_BIN=deveco-code
node "%~dp0agent-wrap.mjs" %*
