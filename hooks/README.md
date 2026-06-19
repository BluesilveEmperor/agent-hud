# Hooks 接入说明

Light 通过本地 HTTP 服务（`127.0.0.1:51789`）接收状态事件。

> **最省事：用 app 内的一键接入。** 展开胶囊面板 →「接入 Agent」→「一键接入」，
> 或右键托盘 →「一键接入 Claude / Codex」。它会把下面这些 hooks **安全合并**进
> `~/.claude/settings.json` 和 `~/.codex/hooks.json`（保留已有配置、不覆盖、先备份），
> 路径自动填好。下面的手动步骤只在你想自己改配置时才需要。

本目录提供两类接入脚本：

## 1. Claude Code

Claude Code 内置 hooks 机制。把以下内容合并到 `~/.claude/settings.json`（推荐 **node 直调 + 正斜杠路径**，规避 Windows 上 `.cmd`/shell 解析问题）：

把下面的 `<LIGHT_DIR>` 换成你本机 light 项目的绝对路径（正斜杠 `/` 在 Windows 上
node 也认，例如 `C:/Users/你的用户名/light`）：

```jsonc
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command",
        "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs session_start" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command",
        "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs session_end" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command",
        "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs user_prompt" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs tool_use" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
        "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs stop" }] }
    ]
  }
}
```

`SessionStart`/`SessionEnd` 让 Claude Code 一开窗就显示"空闲"、关窗就消失。

**关键提醒：**

- 改完 `settings.json` 必须**彻底重启 Claude Code 进程**（不是切会话）才会重新读取。
- 进新窗口先敲 `/hooks` 确认这四项已注册；如有"信任此 hook"提示，确认放行。
- `claude-hook.mjs` 读取 Claude 通过 stdin 推来的 JSON（`session_id`、`tool_name`、`prompt`），提取后 POST 给 Light，并在 `%TEMP%\light-hook.log` 留一行调用日志（排错用）。
- Light 没启动时脚本静默退出，不会阻塞 Claude 的 hook 流水线。
- Mac / Linux 用 `claude-hook.sh`（`chmod +x`），命令写 `bash /path/claude-hook.sh user_prompt`。

## 2. Codex CLI（官方 hooks，推荐）

新版 Codex CLI 已内置 hooks 机制，事件格式与 Claude Code 一致（stdin 推 JSON：
`session_id`、`tool_name`、`tool_input`、`prompt` 等）。把下面内容写进
`~/.codex/hooks.json`（也可放工程目录下的 `.codex/hooks.json`，或 `config.toml`
里的内联 `[hooks]`）。完整模板见同目录的 `codex-hooks.example.json`。

把 `<LIGHT_DIR>` 换成本机 light 的绝对路径（Windows 上正斜杠 `/` 即可，例如
`C:/Users/你的用户名/AppData/Local/Programs/Light`）：

```jsonc
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" session_start", "timeout": 5 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" user_prompt", "timeout": 5 }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" tool_use", "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" stop", "timeout": 5 }] }
    ]
  }
}
```

**关键提醒：**

- 改完 `hooks.json` 重启 Codex CLI 才会重新读取。
- `codex-hook.mjs` 把事件 POST 给 Light，并在 `%TEMP%\light-codex-hook.log` 留调用日志（排错用）。
- Light 没启动时脚本静默退出（始终 `exit 0`），不会阻塞 Codex。
- Codex **没有 SessionEnd 事件**：会话在 `stop` 后变"完成"，随后自动回到"空闲"并被回收，不会立刻消失。
- Mac / Linux 把命令里的 `node "<LIGHT_DIR>/hooks/codex-hook.mjs"` 直接照用即可（node 跨平台）。

## 2b. Codex 包装脚本（旧版回退）

如果你的 Codex 版本还没有 hooks，可用包装脚本兜底：把 `codex <args>` 换成
`codex-wrap.cmd <args>`。它只能在启动时推 `session_start` + `user_prompt`、退出时推
`stop`（或 `error`），中间的 tool 调用看不到——能用官方 hooks 就别用它。

```powershell
# PowerShell profile：给它做 alias
Set-Alias codex 'C:\path\to\Light\hooks\codex-wrap.cmd'
```

## 3. 自定义环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `LIGHT_PORT` | `51789` | Light HTTP 端口（如改了主进程端口需同步） |
| `CODEX_BIN` | `codex` | Codex 二进制路径（PATH 里没有 codex 时用） |

## 4. 手动测试

不装 hook 也可以直接 POST 事件验证 Light 是否工作：

```powershell
$body = @{ agent = 'claude-code'; type = 'user_prompt'; message = 'hello' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'
```
