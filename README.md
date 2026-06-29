# AGENT HUD · 桌面状态胶囊

> 屏幕顶部常驻的悬浮胶囊，实时展示 **Claude Code / Codex / OpenCode / DevEco Code** 的工作状态。
> 磨砂玻璃质感，余光一瞥就知道 AI 在干活、做完了还是出错了，不用切窗口。

基于 [chai1220/light](https://github.com/chai1220/light) 扩展，新增 OpenCode 与
DevEco Code（基于 OpenCode 定制）的接入能力。详细的产品设计见 [PRD.md](PRD.md)。

## 功能

- **状态一目了然**：工作中泛蓝光呼吸、完成变绿打勾、出错变红，还显示当前工具与用时。
- **多会话 / 多 agent**：Claude Code、Codex、OpenCode、DevEco Code 同时跑也能分栏显示，互不打架。
- **一键接入**：app 内一键接入全部 agent——Claude/Codex 安全合并 hooks 配置，OpenCode/DevEco Code 自动拷贝 plugin（安全、不覆盖、自动备份）。
- **顺手的小工具**：桌面备忘录、当前播放的音乐（可上一首 / 下一首 / 暂停）。
- **磨砂玻璃 UI**：任何壁纸下都清晰；鼠标移上去展开详情面板。
- **纯本地**：只监听 `127.0.0.1`，不联网、不上传任何数据。

## 截图（示意）

```
       ╭──────────────────────────────────────────────────────────╮
       │ ● Claude Edit │ ● Codex idle │ ● OpenCode Bash │ ● DevEco │
       ╰──────────────────────────────────────────────────────────╯
              hover → 展开当前任务摘要
              click → 展开事件流面板
```

- `●` 灰：idle
- `●` 蓝（呼吸光晕）：working
- `●` 绿（勾选动画）：done
- `●` 红（抖动）：error

## 快速开始

依赖：Node 18+、Windows / macOS / Linux。

```bash
# 1. 装依赖（首次约 5 分钟，Electron 30.5.1 会优先用本地缓存）
npm install

# 2. 启动开发模式（Vite + Electron）
npm run dev
```

启动成功后，屏幕顶部中央会出现一个深色的胶囊条。把鼠标移上去会展开摘要，点击会展开事件面板。

## 验证一下没装 hook 时也能看到效果

打开一个新终端，发个测试事件：

```powershell
# Windows PowerShell
Invoke-RestMethod -Uri http://127.0.0.1:51789/event -Method POST -ContentType 'application/json' -Body (@{
  agent = 'opencode'
  type = 'user_prompt'
  message = 'Refactor the auth middleware'
} | ConvertTo-Json)
```

```bash
# macOS / Linux
curl -X POST http://127.0.0.1:51789/event \
  -H "Content-Type: application/json" \
  -d '{"agent":"deveco-code","type":"tool_use","tool":"bash","message":"npm test"}'
```

胶囊会切换到蓝色 "working" 状态。再发 `{"agent":"opencode","type":"stop"}` 会变绿，8 秒后回灰。

## 接入 Agent

**最简单的方式（推荐）：** 打开 HUD，鼠标移到胶囊上展开面板 → **「接入 Agent」** 一栏点
**「一键接入」**；或右键托盘图标 → **「一键接入全部 Agent」**。它会按各 agent 的接入方式
自动配置：

| Agent | 接入方式 | 写入位置 |
|---|---|---|
| Claude Code | 合并 hooks JSON | `~/.claude/settings.json` |
| Codex | 合并 hooks JSON | `~/.codex/hooks.json` |
| OpenCode | 拷贝 plugin | `~/.config/opencode/plugins/light-hud.mjs` |
| DevEco Code | 拷贝 plugin | `~/.config/deveco/plugins/light-hud.mjs` |

全程保留已有配置、不覆盖、先写 `.light-backup` 备份，路径自动填好。接入后重启对应 agent 即可生效。

下面是手动配置的方式（不想用一键时）。完整说明见 [hooks/README.md](hooks/README.md)。

### Claude Code

把以下内容合并到 `~/.claude/settings.json`，`<LIGHT_DIR>` 换成本机项目绝对路径
（Windows 上用正斜杠 `/` 即可）：

```json
{
  "hooks": {
    "SessionStart":    [{ "hooks": [{ "type": "command", "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs session_start" }] }],
    "SessionEnd":      [{ "hooks": [{ "type": "command", "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs session_end" }] }],
    "UserPromptSubmit":[{ "hooks": [{ "type": "command", "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs user_prompt" }] }],
    "PreToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs tool_use" }] }],
    "Stop":            [{ "hooks": [{ "type": "command", "command": "node <LIGHT_DIR>/hooks/claude-hook.mjs stop" }] }]
  }
}
```

改完后**彻底重启 Claude Code 进程**才会生效。

### Codex CLI

把下面内容写进 `~/.codex/hooks.json`（模板见 [hooks/codex-hooks.example.json](hooks/codex-hooks.example.json)）：

```json
{
  "hooks": {
    "SessionStart":     [{ "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" session_start" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" user_prompt" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" tool_use" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"<LIGHT_DIR>/hooks/codex-hook.mjs\" stop" }] }]
  }
}
```

老版本 Codex 没有 hooks，可改用 `hooks/codex-wrap.cmd` 包装调用兜底。

### OpenCode / DevEco Code

OpenCode 与 DevEco Code（基于 OpenCode 定制）共用一套 **plugin 事件钩子**机制。把
`hooks/opencode/light-hud.mjs` 拷贝到对应 plugins 目录即可（OpenCode 启动时自动加载，
无需改 `opencode.json`）：

```bash
# OpenCode
mkdir -p ~/.config/opencode/plugins
cp hooks/opencode/light-hud.mjs ~/.config/opencode/plugins/

# DevEco Code
mkdir -p ~/.config/deveco/plugins
cp hooks/opencode/light-hud.mjs ~/.config/deveco/plugins/
```

插件会按安装路径自动上报身份（`opencode` / `deveco-code`），订阅 `session.created`、
`tool.execute.before`、`session.idle` 等事件转发给 HUD。详见
[hooks/opencode/README.md](hooks/opencode/README.md)。

不支持 plugin 的老版本可用 `hooks/opencode-wrap.cmd` / `hooks/deveco-wrap.cmd` 包装兜底。

## 目录结构

```
agent-hud/
├── PRD.md                 # 产品需求文档
├── package.json
├── tsconfig.json          # 渲染层 TS 配置
├── tsconfig.electron.json # 主进程 TS 配置
├── vite.config.ts
├── index.html
├── scripts/
│   └── dev.mjs            # 开发启动脚本（先 Vite 后 Electron）
├── electron/              # 主进程（Node）
│   ├── main.ts            # 入口：窗口 / 托盘 / IPC
│   ├── preload.ts         # 安全 bridge
│   ├── server.ts          # 本地 HTTP 服务
│   ├── state.ts           # 事件状态机（支持 5 种 agent）
│   └── hooks-setup.ts     # 一键接入：Claude/Codex 合并 JSON，OpenCode/DevEco 拷贝 plugin
├── src/                   # 渲染层（React + Framer Motion）
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── types.ts
│   ├── hooks/useLightEvents.ts
│   └── components/
│       ├── Island.tsx
│       ├── AgentPill.tsx
│       └── ExpandPanel.tsx
└── hooks/                      # 注入各 agent 的脚本
    ├── claude-hook.mjs         # Claude Code 适配器
    ├── claude-hook.cmd / .sh
    ├── codex-hook.mjs          # Codex 官方 hooks 适配器
    ├── codex-hook.cmd / .sh
    ├── codex-wrap.mjs / .cmd   # Codex 旧版包装兜底
    ├── opencode/               # OpenCode / DevEco Code 接入
    │   ├── light-hud.mjs       # plugin（按路径自动识别 opencode / deveco-code）
    │   └── README.md
    ├── agent-wrap.mjs          # OpenCode/DevEco 通用包装兜底
    ├── opencode-wrap.cmd / .sh
    ├── deveco-wrap.cmd / .sh
    ├── settings.example.json   # Claude settings 模板
    ├── codex-hooks.example.json # Codex hooks 模板
    └── README.md
```

## HTTP API

`POST http://127.0.0.1:51789/event`

```json
{
  "agent": "claude-code" | "codex" | "opencode" | "deveco-code",
  "type": "session_start" | "session_end" | "user_prompt" | "tool_use" | "stop" | "notification" | "error",
  "sessionId": "可选",
  "tool": "可选，tool_use 时填工具名",
  "message": "可选，文本摘要",
  "timestamp": "可选，ISO8601"
}
```

`GET /health` 健康检查；`GET /state` 拿当前状态（调试用）。

## 隐私与安全

- **纯本地运行**：HTTP 服务只绑定 `127.0.0.1`，不监听公网，外部机器无法访问。
- **不联网、不收集数据**：没有任何遥测 / 上报；备忘录只存在本机
  `%AppData%\light\memos.json`。
- **渲染层隔离**：`contextIsolation: true`、`nodeIntegration: false`，页面拿不到
  Node 能力。
- **不执行任意命令**：`/event` 只接收字符串字段用于显示，服务端不会据此执行 shell；
  媒体控制只接受固定的枚举动作。
- 本地端口 `51789` 无鉴权（按设计——只有本机程序能访问）。如果你介意同机其他程序
  往里发"假状态"，可自行加 token 校验。

## 状态机

| 事件 | 状态变化 |
|---|---|
| `session_start` | → `idle`，清空 currentTool |
| `user_prompt` | → `working`，记录 startedAt 与 lastPrompt |
| `tool_use` | → `working`，更新 currentTool |
| `stop` | → `done`，8 秒后自动转 `idle` |
| `error` | → `error`，5 秒后自动转 `idle` |
| `notification` | 不改状态，只入事件流 |

## 已知限制

- Codex / OpenCode / DevEco Code 都没有 Claude Code 那种「关窗即 SessionEnd」的可靠
  信号：会话在 `stop` 后变"完成"，安静约 15 秒后自动收起胶囊（下次有事件会再出现）。
  OpenCode/DevEco Code 靠 plugin 的 `session.deleted` 事件上报关闭，未触发时走超时收起。
- OpenCode/DevEco Code 的 `tool.execute.before` 不一定带 sessionId，plugin 用「最近会话 id」
  兜底，单会话场景表现正常；同时开多个会话时工具事件可能并入最近那个会话。
- 仅在 Windows 11 上做过完整验证，macOS / Linux 的透明窗口表现可能有差异。
- 安装包通过 `npm run dist` + Inno Setup 生成（见 [installer/README.md](installer/README.md)）。

## 致谢

基于 [chai1220/light](https://github.com/chai1220/light)（MIT）扩展。
OpenCode 接入参考 [OpenCode Plugins 文档](https://opencode.ai/docs/plugins)。
DevEco Code 信息参考华为 HDC 2026 发布的 `@deveco/deveco-code`。

## 许可

[MIT](LICENSE)
