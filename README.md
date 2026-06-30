# AGENT HUD

基于 Light 的桌面状态胶囊，实时显示 Claude Code、Codex、OpenCode 和 DevEco Code 的工作状态。

## 功能特性

- **实时状态显示** - 通过顶部胶囊实时展示 Agent 工作状态（空闲、工作中、完成、错误）
- **多 Agent 支持** - 同时监控多个 AI 编程助手
- **一键接入** - 内置一键配置功能，自动设置 hooks
- **本地 HTTP 服务** - 通过 `127.0.0.1:51789` 接收状态事件
- **备忘录** - 支持记录和管理开发备忘

## 支持的 Agent

| Agent | 接入方式 | 状态 |
|-------|---------|------|
| Claude Code | Hooks (settings.json) | ✅ |
| Codex CLI | Hooks (hooks.json) | ✅ |
| OpenCode | Plugin | ✅ |
| DevEco Code | Plugin | ✅ |

## 快速开始

### 1. 下载安装

从 [Releases](https://github.com/BluesilveEmperor/agent-hud/releases) 下载最新版本。

### 2. 启动应用

运行 `Light.exe` 启动 HUD。

### 3. 接入 Agent

**方式一：一键接入（推荐）**

1. 展开胶囊面板
2. 点击「接入 Agent」
3. 选择对应的 Agent，点击「一键接入」

**方式二：手动配置**

详见 [hooks/README.md](hooks/README.md)

## 项目结构

```
agent-hud/
├── hooks/                    # Agent 接入脚本
│   ├── claude-hook.mjs       # Claude Code hooks
│   ├── codex-hook.mjs        # Codex hooks
│   ├── opencode/             # OpenCode/DevEco Code plugin
│   │   └── light-hud.js
│   └── README.md             # 接入说明
├── resources/
│   └── app/                  # Electron 应用
│       ├── dist-electron/    # 主进程代码
│       ├── dist/             # 渲染进程代码
│       └── package.json
└── Light.exe                 # 主程序
```

## 开发

### 环境要求

- Node.js
- npm

### 本地开发

```bash
# 安装依赖
cd resources/app
npm install

# 启动开发服务器
npm run dev
```

### 构建

```bash
npm run build
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LIGHT_PORT` | `51789` | HTTP 服务端口 |
| `LIGHT_AGENT` | 自动检测 | 强制指定 Agent 身份 |

## 文档

- [Hooks 接入说明](hooks/README.md) - 详细的 Agent 接入指南
- [OpenCode Plugin 说明](hooks/opencode/README.md) - OpenCode/DevEco Code 插件详解

## 许可证

MIT License

## 相关链接

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://github.com/openai/codex)
- [OpenCode](https://github.com/opencode-ai/opencode)
