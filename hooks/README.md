# Hooks 接入说明

AGENT HUD（基于 Light）通过本地 HTTP 服务（`127.0.0.1:51789`）接收状态事件。

> **最省事：用 app 内的一键接入。** 展开胶囊面板 →「接入 Agent」→「一键接入」，
> 或右键托盘 →「一键接入全部 Agent」。它会按各 agent 的接入方式自动配置：
> - Claude Code / Codex / WorkBuddy → 安全合并 hooks 进 `~/.claude/settings.json`、`~/.codex/hooks.json`、`~/.workbuddy/settings.json`
> - OpenCode / DevEco Code / CodeArts Agent → 拷贝 plugin 进 `~/.config/opencode/plugins/`、`~/.config/deveco/plugins/`、`~/.codeartsdoer/plugins/`
> - Hermes Agent → 合并 hooks 进 `~/.hermes/config.yaml` 并预写 `shell-hooks-allowlist.json`
>
> 全程保留已有配置、不覆盖、先写 `.light-backup` 备份，路径自动填好。下面的手动步骤
> 只在你想自己改配置时才需要。
>
> **取消接入**：面板里对应 agent 右侧的「取消」按钮。它只摘除本应用写入的条目
> （hooks 按脚本名精确匹配；plugin 改名为 `.light-backup`），其它配置保持原样。

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

## 2c. WorkBuddy（hooks JSON，与 Claude Code 同格式）

WorkBuddy 的 hooks 与 Claude Code **格式完全一致**（事件名、stdin payload 都相同），
所以复用 `claude-hook.mjs`，只在命令末尾多传一个身份参数 `workbuddy`：

```jsonc
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/claude-hook.mjs\" session_start workbuddy" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/claude-hook.mjs\" session_end workbuddy" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/claude-hook.mjs\" user_prompt workbuddy" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/claude-hook.mjs\" tool_use workbuddy" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
        "command": "node \"<LIGHT_DIR>/hooks/claude-hook.mjs\" stop workbuddy" }] }
    ]
  }
}
```

合并进 `~/.workbuddy/settings.json`（**不要覆盖其它字段**，那个文件还存着沙箱/权限配置）。
实测 WorkBuddy 桌面版改完**无需重启**，下一次工具调用就会触发。

## 2b. Codex 包装脚本（旧版回退）

如果你的 Codex 版本还没有 hooks，可用包装脚本兜底：把 `codex <args>` 换成
`codex-wrap.cmd <args>`。它只能在启动时推 `session_start` + `user_prompt`、退出时推
`stop`（或 `error`），中间的 tool 调用看不到——能用官方 hooks 就别用它。

```powershell
# PowerShell profile：给它做 alias
Set-Alias codex 'C:\path\to\AGENT-HUD\hooks\codex-wrap.cmd'
```

## 3. OpenCode / DevEco Code / CodeArts Agent（plugin 接入，推荐）

OpenCode、DevEco Code 与华为云 CodeArts Agent（码道 CLI/IDE，同为 OpenCode 分支）
共用同一套 **plugin 事件钩子**机制，因此用同一个插件文件 `opencode/light-hud.js`
即可接入三者。插件订阅 `session.created` / `message.updated` /
`tool.execute.before` / `session.idle` / `session.error` / `session.deleted` 事件，
转发给 HUD。

插件会根据**安装路径**自动判断上报身份：

- 装在 `…/opencode/plugins/` → 上报 `opencode`
- 装在 `…/deveco/plugins/` → 上报 `deveco-code`
- 装在 `…/.codeartsdoer/plugins/` → 上报 `codearts`

也可用环境变量 `LIGHT_AGENT=opencode|deveco-code|codearts` 强制指定。

**手动安装：** 把 `opencode/light-hud.js` 拷贝到对应目录（agent 启动时会自动
加载 plugins 目录下所有 `.js/.mjs` 文件，无需在配置里登记）：

```bash
# OpenCode（全局）
mkdir -p ~/.config/opencode/plugins
cp opencode/light-hud.js ~/.config/opencode/plugins/

# DevEco Code（全局，目录名按你的实际配置，默认为 deveco）
mkdir -p ~/.config/deveco/plugins
cp opencode/light-hud.js ~/.config/deveco/plugins/

# CodeArts Agent（全局，IDE 与 CLI 共用同一用户级目录）
mkdir -p ~/.codeartsdoer/plugins
cp opencode/light-hud.js ~/.codeartsdoer/plugins/
```

项目级插件分别放项目根目录的 `.opencode/plugins/`、`.deveco/plugins/`、
`.codeartsdoer/plugins/`。装完**重启对应 agent**（CodeArts 不支持 hook 热加载，
IDE 需整窗重启），发一条消息，HUD 胶囊应出现蓝色"工作中"。

> DevEco Code 的配置目录若被 `OPENCODE_CONFIG_DIR` 等环境变量改过，以你实际目录为准；
> 只要插件路径里含 `deveco`，就会自动上报为 `deveco-code`。CodeArts 同理，路径含
> `codeartsdoer` 即上报为 `codearts`。详见 `opencode/README.md`。

## 3b. OpenCode / DevEco Code 包装脚本（无 plugin 时回退）

如果你的版本不支持 plugin，可用包装脚本兜底，拿到进程级的 start/stop（粒度较粗，
看不到每次工具调用）：

```powershell
# PowerShell profile 里做 alias
Set-Alias opencode 'C:\path\to\AGENT-HUD\hooks\opencode-wrap.cmd'
Set-Alias deveco-code 'C:\path\to\AGENT-HUD\hooks\deveco-wrap.cmd'
```

## 3c. WSL 调用监控（自动识别，无需额外配置）

HUD 会从各 agent 上报的 `tool_use` 命令文本里自动识别 **WSL 调用**
（`wsl` / `wsl.exe`，含 `-e`、`-d <发行版>`、`--distribution`、`--cd`、`bash -c "wsl …"`
等形态），无需在 WSL 里安装任何东西，也不改 agent 的工作流：

- **实时**：胶囊与面板在 agent 跑 `wsl …` 命令时显示青色 `WSL` 徽标 +
  发行版 + WSL 内实际命令（如 `WSL · Ubuntu · python train.py`）
- **历史**：每次 WSL 调用记入 `history.jsonl`（次数 / WSL 内命令分布 / 耗时）
- **统计**：「统计 · 今日」面板展示各 agent 与全局的 WSL 调用次数、耗时与 Top 命令
- **通知**：会话完成 / 出错时，若本轮跑过 WSL 命令，通知标题带 `WSL` 标记，
  正文与 webhook 附最近一次 WSL 命令

识别是纯文本级的：只解析命令字符串，不执行、不监控 WSL 内部进程。`wslpath`、
`/mnt/wsl/...` 路径、普通文本里的 `wsl` 单词不会被误判。

> 提示：Claude Code 的 hook 需要能拿到 `PreToolUse` 的 `tool_input.command` 才能识别
> 命令文本。请使用当前仓库里的 `claude-hook.mjs`（已支持提取 `tool_input`），
> 并用「一键接入」或手动重装一次以更新旧版本脚本。

## 4. Hermes Agent（shell hooks，config.yaml）

[Hermes Agent](https://hermes-agent.nousresearch.com) 的 shell hooks 配置在
`~/.hermes/config.yaml` 的 `hooks:` 块里（YAML，不是 JSON）。推荐用 app 内
「一键接入」：它会把下面的事件合并进 `hooks:` 块，并把每个
`(event, command)` 预写进 `~/.hermes/shell-hooks-allowlist.json`，
这样 gateway / cron 等非交互环境也不会漏注册。全程保留已有配置、
先写 `.light-backup` 备份。

手动接入时把以下内容合并进 `~/.hermes/config.yaml`（把 `<LIGHT_DIR>`
换成本机 AGENT HUD 项目绝对路径，正斜杠）：

```yaml
hooks:
  on_session_start:
    - command: 'node "<LIGHT_DIR>/hooks/hermes-hook.mjs" session_start'
  on_session_finalize:
    - command: 'node "<LIGHT_DIR>/hooks/hermes-hook.mjs" session_end'
  pre_llm_call:
    - command: 'node "<LIGHT_DIR>/hooks/hermes-hook.mjs" user_prompt'
  pre_tool_call:
    - command: 'node "<LIGHT_DIR>/hooks/hermes-hook.mjs" tool_use'
  post_llm_call:
    - command: 'node "<LIGHT_DIR>/hooks/hermes-hook.mjs" stop'
  on_session_end:
    - command: 'node "<LIGHT_DIR>/hooks/hermes-hook.mjs" stop'
```

**事件名说明（容易踩坑）：** shell hooks 用的是 plugin 事件名
（`on_session_start` 这种 `on_` 前缀风格），**不是** gateway 的
`session:create` 冒号风格。`on_session_finalize` 在 `/new`、gateway GC、
CLI 退出时触发，是可靠的"窗口关闭"信号；`on_session_end` 在一次对话运行
结束时触发（含被打断的轮次），所以映射为 `stop` 而不是 `session_end`。

**同意模型：** 每个 `(event, command)` 首次见到时 Hermes 会交互式询问一次。
「一键接入」已替你预授权；手动接入的话，任选其一：
在 `config.yaml` 加 `hooks_auto_accept: true`、设环境变量
`HERMES_ACCEPT_HOOKS=1`、CLI 加 `--accept-hooks`，或按官方格式手写
`~/.hermes/shell-hooks-allowlist.json`（`command` 必须与 YAML 里逐字符一致）。

**其他：**

- 脚本从 stdin 读 Hermes 推送的 JSON（`session_id`、`tool_name`、
  `tool_input`、`extra.user_message`、`extra.model`），stdout 固定输出 `{}`
  （永不阻断 agent），HUD 没启动时静默退出。
- Hermes 的 hook payload 不带 token 计数，所以胶囊只显示状态与模型名，
  不显示上下文用量条。
- 改完 `config.yaml` 需重启 Hermes；可用 `hermes hooks list` 确认注册状态，
  `hermes hooks doctor` 体检。
- 日志同样写在 `%TEMP%\light-hook.log`（排错用）。

## 5. 自定义环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `LIGHT_PORT` | `51789` | HUD HTTP 端口（如改了主进程端口需同步） |
| `LIGHT_AGENT` | 按路径自动判断 | 强制 plugin 上报身份 `opencode` / `deveco-code` / `codearts` |
| `CODEX_BIN` | `codex` | Codex wrapper 包装的二进制 |
| `OPENCODE_BIN` | `opencode` | OpenCode wrapper 包装的二进制 |
| `DEVECO_BIN` | `deveco-code` | DevEco Code wrapper 包装的二进制 |
| `OPENCODE_CONFIG_DIR` | `~/.config/opencode` | OpenCode 配置目录（一键接入目标） |
| `DEVECO_CONFIG_DIR` | `~/.config/deveco` | DevEco Code 配置目录（一键接入目标） |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 配置目录 |
| `CODEX_HOME` | `~/.codex` | Codex 配置目录 |
| `HERMES_HOME` | `~/.hermes` | Hermes Agent 配置目录（一键接入目标） |

## 5. 手动测试

不装 hook 也可以直接 POST 事件验证 HUD 是否工作：

```powershell
# Claude Code
$body = @{ agent = 'claude-code'; type = 'user_prompt'; message = 'hello' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'

# OpenCode
$body = @{ agent = 'opencode'; type = 'tool_use'; tool = 'bash'; message = 'npm test' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'

# WSL 调用（应出现青色 WSL 徽标 + "python train.py"）
$body = @{ agent = 'claude-code'; type = 'tool_use'; tool = 'Bash'; message = 'wsl -d Ubuntu python train.py --epochs 50' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'

# DevEco Code
$body = @{ agent = 'deveco-code'; type = 'stop' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'

# Hermes
$body = @{ agent = 'hermes'; type = 'user_prompt'; message = 'hello hermes' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -Body $body -ContentType 'application/json'
```
