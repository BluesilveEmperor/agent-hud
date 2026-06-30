# AGENT HUD · 桌面状态胶囊

> 屏幕常驻的悬浮胶囊，实时展示 **Claude Code / Codex / OpenCode / DevEco Code** 的工作状态、token 用量与上下文占用。
> 磨砂玻璃质感，余光一瞥就知道 AI 在干活、做完了还是出错了，不用切窗口。

基于 [chai1220/light](https://github.com/chai1220/light) 二次开发，新增多 agent 接入、token 监控、完成通知、会话历史、行为统计、主题切换等功能。

## 功能一览

### 状态展示
- **状态一目了然**：工作中泛蓝光呼吸、完成变绿打勾、出错变红抖动，显示当前工具与用时
- **多会话 / 多 agent**：Claude Code、Codex、OpenCode、DevEco Code 同时跑也能分栏显示
- **可拖动胶囊**：按住胶囊边缘空白处即可拖到屏幕任意位置，点击内容区展开/收起面板

### Token 用量与上下文
- **上下文进度条**：实时显示当前上下文窗口占用（如 87k / 200k），颜色随占用率变化（绿 < 70% < 琥珀 < 90% < 红）
- **Token 统计**：当前上下文 token 数、本次输出 token、会话累计 token
- **完成预测 ETA**：根据 token 消耗速率估算"上下文还需多久填满"，显示在胶囊上（如 `⏳~4m`）
- **数据来源**：Claude Code 解析 transcript jsonl 获取真实 usage；OpenCode/DevEco 从 message API 读取

### 完成通知
- **系统通知**：会话完成/出错时弹出 Windows toast 通知，标题 + prompt 摘要 + 耗时 + token 数
- **Webhook**：可选推送到企业微信 / 飞书 / Slack / 自建服务，让你不在电脑前也能收到
- **防抖**：8 秒以下短任务不通知，同一会话 30 秒内不重复通知

### 会话历史
- **持久化记录**：每个完成的会话落盘到本地 `history.jsonl`（自动保留 30 天）
- **历史回放**：展开面板查看今日历史，点开看详情——工具调用分布、上下文用量、模型、错误信息

### Agent 行为分析
- **今日统计**：各 agent 的会话数、错误数、总耗时、总 token（带对比柱状图）
- **工具排行**：最常用工具 Top 5
- **平均上下文**：了解你的 agent 上下文使用习惯

### 主题与外观
- **三种主题**：深色（默认）/ 浅色 / 跟随系统，托盘菜单或面板内一键切换
- **磨砂玻璃 UI**：任何壁纸下都清晰，深浅模式均适配

### 其他
- **一键接入**：app 内一键接入全部 agent——Claude/Codex 安全合并 hooks 配置，OpenCode/DevEco Code 自动拷贝 plugin
- **桌面备忘录**：随手记下待办
- **媒体控制**：显示当前播放的音乐，可上一首/下一首/暂停
- **纯本地**：只监听 `127.0.0.1`，不联网、不上传任何数据

## 截图（示意）

```
       ╭──────────────────────────────────────────────────────────────╮
       │ ● Claude Bash · 42s · ⏳~4m · ▓▓░░ 87k │ ● OpenCode 完成    │
       ╰──────────────────────────────────────────────────────────────╯
              hover → 展开当前任务摘要 + 上下文进度条
              click → 展开事件流 / 历史 / 统计 / 通知设置 / 主题
```

- `●` 灰：idle
- `●` 蓝（呼吸光晕）：working
- `●` 绿（勾选动画）：done
- `●` 红（抖动）：error

## 快速开始

依赖：Node 18+、Windows / macOS / Linux。

```bash
# 1. 装依赖（国内网络建议加镜像）
npm install

# 2. 启动开发模式（Vite + Electron）
npm run dev
```

启动后屏幕顶部中央出现胶囊。鼠标移上去展开摘要，点击展开完整面板。

### 打包安装包

```bash
# 构建并 stage 到 release/Light/
npm run dist

# 用 Inno Setup 编译安装包（需安装 Inno Setup 6）
iscc installer/light.iss
# → release/AgentHUD-Setup-2.0.0.exe
```

## 接入 Agent

**最简单的方式：** 展开胶囊面板 →「接入 Agent」→「一键接入」，自动配置全部四个 agent。或右键托盘 →「一键接入全部 Agent」。

| Agent | 接入方式 | 写入位置 |
|---|---|---|
| Claude Code | 合并 hooks JSON | `~/.claude/settings.json` |
| Codex | 合并 hooks JSON | `~/.codex/hooks.json` |
| OpenCode | 拷贝 plugin | `~/.config/opencode/plugins/light-hud.js` |
| DevEco Code | 拷贝 plugin | `~/.config/deveco/plugins/light-hud.js` |

全程保留已有配置、不覆盖、先写 `.light-backup` 备份。接入后重启对应 agent 即可生效。手动配置方式见 [hooks/README.md](hooks/README.md)。

## 目录结构

```
agent-hud/
├── package.json
├── tsconfig.json / tsconfig.electron.json
├── vite.config.ts
├── index.html
├── scripts/
│   ├── dev.mjs               # 开发启动脚本
│   └── stage.mjs             # 打包 stage 脚本
├── electron/                  # 主进程（Node）
│   ├── main.ts               # 入口：窗口 / 托盘 / IPC / 主题
│   ├── preload.ts            # 安全 bridge
│   ├── server.ts             # 本地 HTTP 服务 (127.0.0.1:51789)
│   ├── state.ts              # 事件状态机 + ETA 预测
│   ├── memos.ts              # 备忘录持久化
│   ├── system.ts             # 系统状态（媒体等）
│   ├── winbridge.ts          # Windows SMTC / 通知
│   ├── hooks-setup.ts        # 一键接入（hooks JSON / plugin 双模式）
│   ├── history.ts            # 会话历史持久化 + 统计
│   ├── notifier.ts           # 完成通知（系统通知 + webhook）
│   └── theme.ts              # 主题存储（深色/浅色/跟随系统）
├── src/                       # 渲染层（React + Framer Motion）
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── types.ts
│   ├── usage.ts              # token 格式化工具
│   ├── hooks/useLightEvents.ts
│   └── components/
│       ├── Island.tsx        # 胶囊主体（可拖动）
│       ├── AgentPill.tsx     # 单 agent 分栏
│       ├── ExpandPanel.tsx   # 展开面板（状态/接入/通知/统计/历史/主题）
│       └── MediaCard.tsx     # 媒体控制
├── hooks/                     # 注入各 agent 的脚本
│   ├── claude-hook.mjs       # Claude Code（解析 transcript 上报 usage）
│   ├── codex-hook.mjs        # Codex
│   ├── opencode/
│   │   └── light-hud.js      # OpenCode / DevEco Code plugin
│   ├── agent-wrap.mjs        # 通用包装兜底
│   └── README.md             # 手动接入说明
├── bridge/                    # Windows PowerShell 辅助脚本
├── installer/
│   ├── light.iss             # Inno Setup 脚本
│   └── light.ico
└── PRD.md                     # 产品需求文档
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
  "usage": {
    "contextTokens": 87420,
    "contextLimit": 200000,
    "outputTokens": 1240,
    "totalTokens": 312480,
    "model": "claude-sonnet-4-5"
  },
  "timestamp": "可选，ISO8601"
}
```

`GET /health` 健康检查；`GET /state` 拿当前状态。

## 隐私与安全

- **纯本地运行**：HTTP 服务只绑定 `127.0.0.1`，不监听公网
- **不联网、不收集数据**：没有遥测/上报；备忘录、历史、配置只存在本机 `%AppData%`
- **渲染层隔离**：`contextIsolation: true`、`nodeIntegration: false`
- **不执行任意命令**：`/event` 只接收字符串字段用于显示

## 技术栈

- **Electron 30** + **React 18** + **TypeScript** + **Vite**
- **Framer Motion** 动画
- **Inno Setup** 打包安装包
- 零运行时第三方依赖（主进程仅用 Node 内置模块）

## 致谢

基于 [chai1220/light](https://github.com/chai1220/light)（MIT）二次开发。

OpenCode 接入参考 [OpenCode Plugins 文档](https://opencode.ai/docs/plugins)。DevEco Code 信息参考华为 HDC 2026 发布的 `@deveco/deveco-code`。

## 许可

[MIT](LICENSE)
