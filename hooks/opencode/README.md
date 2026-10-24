# OpenCode / DevEco Code / CodeArts Agent 接入说明

AGENT HUD（基于 Light）通过本地 HTTP 服务（`127.0.0.1:51789`）接收状态事件。
OpenCode、DevEco Code 与华为云 CodeArts Agent（码道，含 CLI 与 IDE，均为 OpenCode
分支）共用同一套 **plugin 事件钩子**机制，因此用同一个插件文件 `light-hud.js`
即可接入三者。

> **最省事：用 app 内的一键接入。** 展开胶囊面板 →「接入 Agent」→ 分别点
> OpenCode / DevEco Code / CodeArts Agent 的「接入」按钮。它会把这个插件**拷贝**到
> `~/.config/opencode/plugins/`、`~/.config/deveco/plugins/` 或
> `~/.codeartsdoer/plugins/`（自动建目录），
> 已有同名文件会被 `.light-backup` 备份。下面的手动步骤只在你想自己管理时才需要。

## 工作原理

插件订阅 OpenCode 的生命周期事件，转发给 HUD：

| OpenCode 事件 | HUD 事件 | 含义 |
|---|---|---|
| `session.created` | `session_start` | 新会话，显示「空闲」 |
| `message.updated`（user） | `user_prompt` | 用户提问，切「工作中」 |
| `tool.execute.before` | `tool_use` | 调用工具，更新当前工具名 |
| `session.idle` | `stop` | 会话空闲，切「完成」 |
| `session.error` | `error` | 出错 |
| `session.deleted` | `session_end` | 会话删除，胶囊收起 |

插件会根据**安装路径**自动判断上报身份：
- 装在 `…/opencode/plugins/` → 上报 `opencode`
- 装在 `…/deveco/plugins/` → 上报 `deveco-code`
- 装在 `…/.codeartsdoer/plugins/` → 上报 `codearts`

也可用环境变量 `LIGHT_AGENT=opencode|deveco-code|codearts` 强制指定。

## 手动安装

把 `light-hud.js` 拷贝到对应目录（OpenCode 启动时会自动加载 plugins 目录下
所有 `.js/.mjs` 文件，无需在 `opencode.json` 里登记）：

```bash
# OpenCode（全局）
mkdir -p ~/.config/opencode/plugins
cp light-hud.js ~/.config/opencode/plugins/

# DevEco Code（全局，目录名按你的实际配置，默认为 deveco）
mkdir -p ~/.config/deveco/plugins
cp light-hud.js ~/.config/deveco/plugins/
```

项目级插件放项目根目录的 `.opencode/plugins/`（或 `.deveco/plugins/`）。

> DevEco Code 的配置目录若被 `OPENCODE_CONFIG_DIR` 等环境变量改过，以你实际
> 目录为准；只要插件路径里含 `deveco`，就会自动上报为 `deveco-code`。

装完**重启 OpenCode / DevEco Code**，发一条消息，HUD 顶部胶囊应出现蓝色「工作中」。

## 兜底：包装脚本（无 plugin 时回退）

如果你的版本不支持 plugin，可用包装脚本兜底，拿到进程级的 start/stop（粒度较粗，
看不到每次工具调用）：

```powershell
# PowerShell profile 里做 alias
Set-Alias opencode 'C:\path\to\AGENT-HUD\hooks\opencode-wrap.cmd'
Set-Alias deveco-code 'C:\path\to\AGENT-HUD\hooks\deveco-wrap.cmd'
```

## 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `LIGHT_PORT` | `51789` | HUD 的 HTTP 端口（改了主进程端口需同步） |
| `LIGHT_AGENT` | 按路径自动判断 | 强制上报身份 `opencode` / `deveco-code` |
| `OPENCODE_BIN` | `opencode` | wrapper 包装的 opencode 二进制 |
| `DEVECO_BIN` | `deveco-code` | wrapper 包装的 deveco-code 二进制 |

## 已知限制

- OpenCode/DevEco Code 没有 Claude Code 那种「关窗即 SessionEnd」的可靠信号，
  插件靠 `session.deleted` 上报；若该事件未触发，HUD 会在会话安静约 15 秒后
  自动收起胶囊，下次有事件再出现。
- `tool.execute.before` 不一定带 sessionId，插件用「最近会话 id」兜底，单会话
  场景表现正常；同时开多个会话时工具事件可能并入最近那个会话。
