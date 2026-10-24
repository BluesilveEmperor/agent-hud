# AGENT HUD · 桌面状态胶囊

> 屏幕常驻的悬浮胶囊，实时展示 **Claude Code / Codex / OpenCode / DevEco Code / CodeArts Agent / WorkBuddy** 的工作状态、token 用量与上下文占用。
> 磨砂玻璃质感 + 双边流光 + 点光源效果，余光一瞥就知道 AI 在干活、做完了还是出错了，不用切窗口。

基于 [chai1220/light](https://github.com/chai1220/light) 二次开发，新增多 agent 接入、token 监控、完成通知、会话历史、行为统计、主题切换、HarmonyOS 风格视效、WSL 调用监控等功能。

当前版本 **4.0.0**。

## 功能一览

### 状态展示
- **状态一目了然**：工作中泛蓝光呼吸、完成变绿打勾、出错变红抖动，显示当前工具与用时
- **多会话 / 多 agent**：Claude Code、Codex、OpenCode、DevEco Code、CodeArts Agent、WorkBuddy 同时跑也能分栏显示
- **可拖动胶囊**：按住胶囊边缘空白处即可拖到屏幕任意位置，点击内容区展开/收起面板

### HarmonyOS 风格视效（3.0 新增）
- **双边流光**：青色 `#1AD0F1` + 粉色 `#FFA4E5` 两条彗星沿胶囊圆角边框旋转，4 秒一圈（参考 HarmonyOS UI Design Kit 官方规格）
- **点光源效果**：状态圆点、播放按钮、主题切换按钮、备忘录勾选圆作为光源发光，邻居文字/按钮受光染色
  - Agent 圆点工作时发出青色三层辐射光，照亮旁边的名称和状态文字
  - 播放按钮发白光辐射，照亮相邻的上一曲/下一曲按钮和歌名
  - 主题 active 按钮发青光照亮邻居按钮
  - 备忘录勾选发绿光照亮文字
- **马卡龙配色**：柔和的马卡龙色系（薰衣草灰、粉蓝、开心果绿、草莓粉），告别饱和硬朗
- **浅色模式对齐**：深浅模式透明度完全一致，浅色模式同样能透出壁纸

### Token 用量与上下文
- **上下文进度条**：实时显示当前上下文窗口占用（如 87k / 200k），颜色随占用率变化（绿 < 70% < 琥珀 < 90% < 红）
- **Token 统计**：当前上下文 token 数、本次输出 token、会话累计 token
- **完成预测 ETA**：根据 token 消耗速率估算"上下文还需多久填满"，显示在胶囊上（如 `⏳~4m`）
- **数据来源**：Claude Code 解析 transcript jsonl 获取真实 usage；OpenCode/DevEco 从 message API 读取

### WSL 调用监控（4.0 新增，4.1 完善）
- **实时识别**：agent 发起 `wsl` / `wsl.exe` 命令（含 `-e`、`-d <发行版>`、`bash -c "wsl …"` 等形态）时，胶囊与面板显示青色 `WSL` 徽标 + 发行版 + WSL 内实际命令
- **进度可视化**：胶囊与面板显示薄荷绿进度条 + 百分比，按该命令的历史平均时长估算（如 `python train.py · 56%`）；新命令首次执行时提示"暂无进度估算"
- **历史与统计**：每次 WSL 调用记入 `history.jsonl`（含按命令拆分的时长），「统计 · 今日」面板展示各 agent 与全局的 WSL 调用次数、耗时与 Top 命令
- **完成通知**：跑过 WSL 命令的会话完成/出错时，通知标题带 `WSL` 标记，正文与 webhook 附最近一次 WSL 命令
- **零侵入**：纯文本级识别命令字符串，不在 WSL 内安装任何脚本、不改 agent 工作流；`wslpath`、`/mnt/wsl/...` 路径与普通文本里的 `wsl` 单词不会误判
- **全 agent 支持**：Claude Code / Codex / OpenCode / DevEco Code 上报的命令文本都会识别。OpenCode/DevEco 从 `tool.execute.before` 的入参读取命令，Claude/Codex 从 `PreToolUse` 的 `tool_input` 读取

### 完成通知
- **系统通知**：会话完成/出错时弹出系统 toast 通知，标题 + prompt 摘要 + 耗时 + token 数
- **Webhook**：可选推送到企业微信 / 飞书 / Slack / 自建服务，让你不在电脑前也能收到
- **防抖**：8 秒以下短任务不通知，同一会话 30 秒内不重复通知

### 会话历史
- **持久化记录**：每个完成的会话落盘到本地 `history.jsonl`（自动保留 30 天）
- **历史回放**：展开面板查看今日历史，点开看详情——工具调用分布、上下文用量、模型、错误信息、WSL 调用

### Agent 行为分析
- **今日统计**：各 agent 的会话数、错误数、总耗时、总 token、WSL 调用次数（带对比柱状图）
- **工具排行**：最常用工具 Top 5
- **平均上下文**：了解你的 agent 上下文使用习惯
- **WSL 排行**：最常用 WSL 命令 Top 5

### 主题与外观
- **三种主题**：深色（默认）/ 浅色 / 跟随系统，托盘菜单或面板内一键切换
- **磨砂玻璃 UI**：任何壁纸下都清晰，深浅模式透明度完全对齐，均能透出桌面壁纸
- **马卡龙配色**：柔和马卡龙色系，状态点、光晕、流光色彩统一

### 其他
- **一键接入**：app 内一键接入全部 agent——Claude/Codex 安全合并 hooks 配置，OpenCode/DevEco Code/CodeArts Agent 自动拷贝 plugin
- **桌面备忘录**：随手记下待办
- **媒体控制**：显示当前播放的音乐，左侧展示来源媒体应用的应用图标（自动提取），可上一首/下一首/暂停（仅 Windows SMTC）
- **纯本地**：只监听 `127.0.0.1`，不联网、不上传任何数据
- **浏览器内调试**：`npm run dev:web` 即可在普通浏览器中开发调试 UI（内置 mock 数据，见 `src/devMock.ts`）

## 截图（示意）

```
       ╭──────────────────────────────────────────────────────────────╮
       │ ● Claude WSL · Ubuntu · python train.py · 56% · 1m23s       │
       │ ● Codex 完成 · 1m · ▓▓░░ 87k                               │
       ╰──────────────────────────────────────────────────────────────╯
                    ↑ 双边流光环绕（青+粉彗星旋转）
              hover → 展开当前任务摘要 + 上下文进度条
              click → 展开事件流 / 历史 / 统计 / 通知设置 / 主题
```

- `●` 灰：idle
- `●` 蓝（三层呼吸光晕 + 邻居文字受光）：working
- `●` 绿（勾选动画 + 绿光辐射）：done
- `●` 红（抖动 + 红光辐射）：error

## 快速开始

依赖：Node 18+、Windows / macOS / Linux。

```bash
# 1. 装依赖（国内网络建议加镜像）
npm install

# 2. 启动开发模式（Vite + Electron）
npm run dev
```

启动后屏幕顶部中央出现胶囊。鼠标移上去展开摘要，点击展开完整面板。

### 浏览器内开发调试（无需 Electron）

```bash
npm run dev:web    # 在浏览器打开 http://localhost:5173
```

内置 mock 数据，支持 URL 参数切换状态：
- `?mock=working` / `?mock=done` / `?mock=error` / `?mock=idle` / `?mock=multi` / `?mock=cycle`
- `?bg=dark` / `?bg=white` / `?bg=photo`

### 打包安装包

项目支持 **Windows / macOS / Linux** 三平台。Electron 本身跨平台，代码已做平台适配。

#### Windows（需要 Inno Setup）

```bash
npm run dist          # build + stage → release/AgentHUD/
iscc installer/light.iss
# → release/AgentHUD-Setup-4.0.0.exe
```

#### macOS

```bash
npm run dist:mac      # build + stage + pack-dmg
# → release/AgentHUD-4.0.0.dmg
```

`pack-dmg.mjs` 使用系统自带的 `hdiutil`，无需额外依赖。

#### Linux (Ubuntu / Debian)

```bash
npm run dist:linux    # build + stage + pack-tarball
# → release/AgentHUD-4.0.0-linux-x64.tar.gz
```

解压后运行：
```bash
tar xzf AgentHUD-4.0.0-linux-x64.tar.gz
./AgentHUD/run.sh
# 想出现在应用菜单里（无需 root）：
./AgentHUD/install-desktop.sh
```

> Linux 上透明窗口的表现取决于桌面环境（GNOME/KDE/X11/Wayland）。Wayland 下透明可能不生效，建议在 X11 会话中运行。
> 托盘图标依赖系统托盘支持（GNOME 需装 AppIndicator 扩展）；没有托盘时可用胶囊面板操作，功能不受影响。

#### macOS 首次运行

DMG 里的 `.app` 未做代码签名/公证，Gatekeeper 会拦。任选其一：

```bash
# 方式一：命令行去隔离属性（推荐）
xattr -cr /Applications/AgentHUD.app
open /Applications/AgentHUD.app
# 方式二：Finder 里右键 → 打开 → 再点「打开」
```

> 未签名意味着首次启动会提示"无法验证开发者"，这是预期行为，不是文件损坏。

#### 用 electron-builder 统一打包（可选）
项目也配置了 electron-builder，可以在对应平台上生成标准安装包：

```bash
npm install
npx electron-builder --win    # Windows: NSIS 安装包
npx electron-builder --mac    # macOS: DMG
npx electron-builder --linux  # Linux: AppImage + deb
```

> electron-builder 要求 ICO 文件包含 256×256 条目。仓库自带 `scripts/fix-ico256.mjs` 自动为 `installer/light.ico` 生成 256×256 PNG 条目（纯 Node + zlib，无额外依赖）。CI 中已自动执行该步骤。

#### CI 自动构建（GitHub Actions）

仓库自带 `.github/workflows/build-release.yml`，打 `v*` tag 时自动在 Windows/macOS/Linux 三平台并行构建并发布 GitHub Release：

```bash
git tag v4.0.0
git push origin v4.0.0
# → Actions 页面查看构建进度，完成后 Release 页面下载安装包
```

CI 流程：
1. 安装 Node 22 + 项目依赖
2. 自动运行 `fix-ico256.mjs` 确保 ICO 文件满足 electron-builder 的 256×256 要求
3. 三平台并行构建：
   - Windows：Inno Setup 安装包
   - macOS：DMG 镜像
   - Linux：tarball 压缩包
4. 自动创建 GitHub Release 并上传全部产物

> **构建必须在目标平台上进行**：`npm run dist:mac` 需要 macOS 的 `hdiutil`/`sips`/`iconutil`，
> `npm run dist:linux` 需要在 Linux 上跑（`tar`/`chmod`/可执行位）。Windows 只能产出 Windows 包。
> 三平台并行构建交给 `.github/workflows/build-release.yml`（打 `v*` tag 触发）。

### 平台差异说明

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 状态胶囊 + 拖动 | 完整支持 | 完整支持 | 完整支持 |
| Token 用量 / 上下文 | 完整支持 | 完整支持 | 完整支持 |
| 完成通知（系统通知） | Toast | Notification Center | libnotify |
| Webhook 通知 | 完整支持 | 完整支持 | 完整支持 |
| 会话历史 / 统计 | 完整支持 | 完整支持 | 完整支持 |
| 主题切换 | 完整支持 | 完整支持 | 完整支持 |
| 媒体控制（播放/暂停等） | SMTC 支持 | 暂不支持 | 暂不支持 |
| WSL 调用监控 | 完整支持 | 完整支持 | 完整支持 |
| 一键接入 hooks | 完整支持 | 完整支持 | 完整支持 |
| 应用图标 | `.ico` | `.icns`（构建时由 `light.png` 生成） | `.png` |
| 安装包 | Inno Setup / NSIS | `.dmg`（拖入 Applications） | `.tar.gz` + 应用菜单注册脚本 |

> 所有 agent 的配置目录都是跨平台同一套（`~/.claude`、`~/.codex`、`~/.config/opencode`、
> `~/.codeartsdoer`、`~/.workbuddy`、`~/.hermes`），macOS 与 Linux 无需额外指定路径。

## 接入 Agent

**最简单的方式：** 展开胶囊面板 →「接入 Agent」→「一键接入」，自动配置全部已支持的 agent。或右键托盘 →「一键接入全部 Agent」。

| Agent | 接入方式 | 写入位置 |
|---|---|---|
| Claude Code | 合并 hooks JSON | `~/.claude/settings.json` |
| Codex | 合并 hooks JSON | `~/.codex/hooks.json` |
| OpenCode | 拷贝 plugin | `~/.config/opencode/plugins/light-hud.js` |
| DevEco Code | 拷贝 plugin | `~/.config/deveco/plugins/light-hud.js` |
| CodeArts Agent | 拷贝 plugin | `~/.codeartsdoer/plugins/light-hud.js` |
| WorkBuddy | 合并 hooks JSON | `~/.workbuddy/settings.json` |

全程保留已有配置、不覆盖、先写 `.light-backup` 备份。接入后重启对应 agent 即可生效。手动配置方式见 [hooks/README.md](hooks/README.md)。

**单独取消某个 agent：** 面板里每个已接入的 agent 右侧都有「取消」按钮，只移除**本应用写入的**那部分——
hooks JSON 里按脚本名精确摘除（其它 hook、其它配置一个不动），plugin 模式把 `light-hud.js` 改名为
`.light-backup`（不再加载但可随时恢复）。用户自己写的同名插件（无本应用标记）会被识别并跳过，不会误删。

## 目录结构

```
agent-hud/
├── package.json
├── tsconfig.json / tsconfig.electron.json
├── vite.config.ts
├── index.html
├── scripts/
│   ├── dev.mjs               # 开发启动脚本
│   ├── stage.mjs             # 打包 stage 脚本
│   ├── fix-ico256.mjs        # 为 light.ico 生成 256×256 PNG 条目
│   ├── pack-dmg.mjs          # macOS DMG 打包（用 hdiutil，无额外依赖）
│   └── pack-tarball.mjs      # Linux tarball 打包
├── electron/                  # 主进程（Node）
│   ├── main.ts               # 入口：窗口 / 托盘 / IPC / 主题
│   ├── preload.ts            # 安全 bridge
│   ├── server.ts             # 本地 HTTP 服务 (127.0.0.1:51789)
│   ├── state.ts              # 事件状态机 + ETA 预测 + WSL 进度
│   ├── memos.ts              # 备忘录持久化
│   ├── system.ts             # 系统状态（媒体等）
│   ├── winbridge.ts          # Windows SMTC / 通知
│   ├── hooks-setup.ts        # 一键接入（hooks JSON / plugin 双模式）
│   ├── history.ts            # 会话历史持久化 + 统计 + WSL 记录
│   ├── notifier.ts           # 完成通知（系统通知 + webhook + WSL 标记）
│   ├── theme.ts              # 主题存储（深色/浅色/跟随系统）
│   └── wsl.ts                # WSL 调用检测（纯文本零侵入）
├── src/                       # 渲染层（React + Framer Motion）
│   ├── App.tsx
│   ├── main.tsx
│   ├── devMock.ts            # 浏览器开发调试 mock 数据
│   ├── styles.css
│   ├── types.ts
│   ├── usage.ts              # token 格式化工具
│   ├── hooks/useLightEvents.ts
│   └── components/
│       ├── Island.tsx        # 胶囊主体（可拖动）
│       ├── AgentPill.tsx     # 单 agent 分栏 + WSL 进度条
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
│   ├── win-bridge.ps1         # 媒体检测 + 应用图标提取（SMTC）
│   └── media-control.ps1      # 媒体播放控制（上一曲/下一曲/暂停）
├── installer/
│   ├── light.iss             # Inno Setup 脚本
│   └── light.ico             # 应用图标（含 256×256 PNG 条目）
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
- **WSL 零侵入**：不修改 WSL 内任何东西，纯文本匹配

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
