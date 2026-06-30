# Hooks 接入说明

AGENT HUD（基于 Light）通过本地 HTTP 服务（`127.0.0.1:51789`）接收状态事件。

> **最省事：用 app 内的一键接入。** 展开胶囊面板 →「接入 Agent」→「一键接入」，
> 或右键托盘 →「一键接入全部 Agent」。它会按各 agent 的接入方式自动配置：
> - Claude Code / Codex → 安全合并 hooks 进 `~/.claude/settings.json`、`~/.codex/hooks.json`
> - OpenCode / DevEco Code → 拷贝 plugin 进 `~/.config/opencode/plugins/`、`~/.config/deveco/plugins/`
>
> 全程保留已有配置、不覆盖、先写 `.light-backup` 备份，路径自动填好。下面的手动步骤
> 只在你想自己改配置时才需要。

## 1. Claude Code

Claude Code 内置 hooks 机制。把以下内容合并到 `~/.claude/settings.json`（推荐 **node 直调 + 正斜杠路径**，规避 Windows 上 `.cmd`/shell 解析问题）：

把 `<LIGHT_DIR>` 换成你本机 AGENT HUD 项目的绝对路径（正斜杠 `/` 在 Windows 上
node 也认，例如 `C:/Users/你的用户名/agent-hud`）：

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
- `claude-hook.mjs` 读取 Claude 通过 stdin 推来的 JSON（`session_id`、`tool_name`、`prompt`），提取后 POST 给 HUD，并在 `%TEMP%\light-hook.log` 留一行调用日志（排错用）。
- HUD 没启动时脚本静默退出，不会阻塞 Claude 的 hook 流水线。
- Mac / Linux 用 `claude-hook.sh`（`chmod +x`），命令写 `bash /path/claude-hook.sh user_prompt`。

## 2. Codex CLI（官方 hooks，推荐）

新版 Codex CLI 已内置 hooks 机制，事件格式与 Claude Code 一致（stdin 推 JSON：
`session_id`、`tool_name`、`tool_input`、`prompt` 等）。把下面内容写进
`~/.codex/hooks.json`（也可放工程目录下的 `.codex/hooks.json`，或 `config.toml`
里的内联 `[hooks]`）。完整模板见同目录的 `codex-hooks.example.json`。

把 `<LIGHT_DIR>` 换成本机 AGENT HUD 的绝对路径（Windows 上正斜杠 `/` 即可）：

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
- `codex-hook.mjs` 把事件 POST 给 HUD，并在 `%TEMP%\light-codex-hook.log` 留调用日志（排错用）。
- HUD 没启动时脚本静默退出（始终 `exit 0`），不会阻塞 Codex。
- Codex **没有 SessionEnd 事件**：会话在 `stop` 后变"完成"，随后自动回到"空闲"并被回收，不会立刻消失。
- Mac / Linux 把命令里的 `node "<LIGHT_DIR>/hooks/codex-hook.mjs"` 直接照用即可（node 跨平台）。

## 2b. Codex 包装脚本（旧版回退）

如果你的 Codex 版本还没有 hooks，可用包装脚本兜底：把 `codex <args>` 换成
`codex-wrap.cmd <args>`。它只能在启动时推 `session_start` + `user_prompt`、退出时推
`stop`（或 `error`），中间的 tool 调用看不到——能用官方 hooks 就别用它。

```powershell
# PowerShell profile：给它做 alias
Set-Alias codex 'C:\path\to\AGENT-HUD\hooks\codex-wrap.cmd'
```

## 3. OpenCode / DevEco Code（plugin 接入，推荐）

OpenCode 与 DevEco Code（基于 OpenCode 定制）共用同一套 **plugin 事件钩子**机制，
因此用同一个插件文件 `opencode/light-hud.js` 即可接入两者。插件订阅 OpenCode 的
`session.created` / `message.updated` / `tool.execute.before` / `session.idle` /
`session.error` / `session.deleted` 事件，转发给 HUD。

插件会根据**安装路径**自动判断上报身份：

- 装在 `…/opencode/plugins/` → 上报 `opencode`
- 装在 `…/deveco/plugins/` → 上报 `deveco-code`

也可用环境变量 `LIGHT_AGENT=opencode|deveco-code` 强制指定。

**手动安装：** 把 `opencode/light-hud.js` 拷贝到对应目录（OpenCode 启动时会自动
加载 plugins 目录下所有 `.js/.mjs` 文件，无需在 `opencode.json` 里登记）：

```bash
# OpenCode（全局）
mkdir -p ~/.config/opencode/plugins
cp opencode/light-hud.js ~/.config/opencode/plugins/

# DevEco Code（全局，目录名按你的实际配置，默认为 deveco）
mkdir -p ~/.config/deveco/plugins
cp opencode/light-hud.js ~/.config/deveco/plugins/
```

项目级插件放项目根目录的 `.opencode/plugins/`（或 `.deveco/plugins/`）。装完**重启
OpenCode / DevEco Code**，发一条消息，HUD 胶囊应出现蓝色"工作中"。

> DevEco Code 的配置目录若被 `OPENCODE_CONFIG_DIR` 等环境变量改过，以你实际目录为准；
> 只要插件路径里含 `deveco`，就会自动上报为 `deveco-code`。详见
> `opencode/README.md`。

## 3b. OpenCode / DevEco Code 包装脚本（无 plugin 时回退）

如果你的版本不支持 plugin，可用包装脚本兜底，拿到进程级的 start/stop（粒度较粗，
看不到每次工具调用）：

```powershell
# PowerShell profile 里做 alias
Set-Alias opencode 'C:\path\to\AGENT-HUD\hooks\opencode-wrap.cmd'
Set-Alias deveco-code 'C:\path\to\AGENT-HUD\hooks\deveco-wrap.cmd'
```

## 4. 自定义环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `LIGHT_PORT` | `51789` | HUD HTTP 端口（如改了主进程端口需同步） |
| `LIGHT_AGENT` | 按路径自动判断 | 强制 plugin 上报身份 `opencode` / `deveco-code` |
| `CODEX_BIN` | `codex` | Codex wrapper 包装的二进制 |
| `OPENCODE_BIN` | `opencode` | OpenCode wrapper 包装的二进制 |
| `DEVECO_BIN` | `deveco-code` | DevEco Code wrapper 包装的二进制 |
| `OPENCODE_CONFIG_DIR` | `~/.config/opencode` | OpenCode 配置目录（一键接入目标） |
| `DEVECO_CONFIG_DIR` | `~/.config/deveco` | DevEco Code 配置目录（一键接入目标） |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 配置目录 |
| `CODEX_HOME` | `~/.codex` | Codex 配置目录 |

## 5. 手动测试

不装 hook 也可以直接 POST 事件验证 HUD 是否工作：

```powershell
# Claude Code
$body = @{ agent = 'claude-code'; type = 'user_prompt'; message = 'hello' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'

# OpenCode
$body = @{ agent = 'opencode'; type = 'tool_use'; tool = 'bash'; message = 'npm test' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'

# DevEco Code
$body = @{ agent = 'deveco-code'; type = 'stop' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'
```
