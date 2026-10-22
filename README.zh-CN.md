<div align="center">

<img src="assets/icon.png" width="128" alt="ccUI">

<h1>ccUI</h1>

<p><b>把 Claude Code 变成桌面应用。</b></p>

<p>每处编辑都是 diff，每个权限请求都是按钮，多个会话并排运行，<br>
Claude Code 自带的 CLI 一键可达，对话始终是同一个。</p>

<p>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/ShinyPoint/ccUI?style=flat-square&color=D97757&label=release"></a>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-D97757?style=flat-square"></a>
<img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-1D1D1F?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="Claude Agent SDK" src="https://img.shields.io/badge/Claude%20Agent%20SDK-0.3-D97757?style=flat-square&logo=anthropic&logoColor=white">
<img alt="English and Simplified Chinese" src="https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-1D1D1F?style=flat-square">
</p>

<p><a href="README.md">English</a> · <b>简体中文</b></p>

<p>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="下载 Windows 版" src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-Windows-D97757?style=for-the-badge&logo=windows&logoColor=white"></a>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="下载 macOS 版" src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-macOS-D97757?style=for-the-badge&logo=apple&logoColor=white"></a>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="下载 Linux 版" src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-Linux-D97757?style=for-the-badge&logo=linux&logoColor=white"></a>
</p>

<img src="docs/demo.gif" width="100%" alt="ccUI 使用演示：Claude 读取文件并以 diff 形式修改，权限请求以按钮呈现，同一段对话在 CLI 中继续">

</div>

> [!NOTE]
> ccUI 是独立项目，并非由 Anthropic 开发、认可或提供支持。

## 亮点

<table>
<tr>
<td width="50%" valign="top"><img src="docs/permissions.jpg" alt="权限请求：允许、允许并不再询问、拒绝，下方是任务清单"><br>
<b>权限请求就是按钮。</b>允许一次、允许并以后不再询问（会显示具体添加的规则），或者拒绝并附一句话，告诉 Claude
应该改做什么。Claude 的任务清单实时显示在输入框上方。</td>
<td width="50%" valign="top"><img src="docs/question.jpg" alt="Claude 的选择题显示为表单"><br>
<b>问题变成表单。</b>Claude 的选择题、待批准的计划，以及它的每一步都清楚地占一行：读了什么、搜了什么、改了什么、
运行了什么。</td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/cli.jpg" alt="同一段对话在 Claude Code 自带的 CLI 中继续"><br>
<b>真正的 CLI，一键切换。</b>在 Claude Code 自带的终端界面中继续同一段对话，再切回对话视图。每个会话下方还停靠着
一个项目文件夹中的 shell。</td>
<td width="50%" valign="top"><img src="docs/theme.jpg" alt="陶土色配色叠加背景图片"><br>
<b>随心定制。</b>深色或浅色、Claude 桌面版的暖色调陶土色、毛玻璃效果、自己的背景图片，界面可选英文或简体中文。</td>
</tr>
</table>

## 目录

- [快速开始](#快速开始)
- [功能](#功能)
- [常见问题](#常见问题)
- [账户与登录](#账户与登录)
- [安全](#安全)
- [快捷键](#快捷键)
- [开发](#开发)
- [打包](#打包)
- [项目结构](#项目结构)
- [反馈与贡献](#反馈与贡献)
- [许可证](#许可证)

## 快速开始

### 下载

在 [Releases](https://github.com/ShinyPoint/ccUI/releases/latest) 下载最新版本：

| 系统 | 文件 | |
| --- | --- | --- |
| Windows 10 / 11（x64） | `ccUI-Setup-<版本>-x64.exe` | 安装版。也可以用 `…-portable.exe`，免安装直接运行 |
| macOS 12+（Apple 芯片） | `ccUI-<版本>-mac-arm64.dmg` | 打开后把 ccUI 拖进"应用程序" |
| macOS 12+（Intel） | `ccUI-<版本>-mac-x64.dmg` | |
| Linux（x64） | `ccUI-<版本>-linux-x86_64.AppImage` 或 `…-linux-amd64.deb` | AppImage：先 `chmod +x` 再运行 |

**第一次开始会话需要等一会儿：** 安装包不包含 Claude Code，ccUI 会在第一次开始会话时从 npm 下载（约 135 MB，只需一次），
并显示下载进度。之后登录即可，见[账户与登录](#账户与登录)。

安装包暂未签名：
- **Windows** SmartScreen 可能提示"Windows 已保护你的电脑"：点击**更多信息 → 仍要运行**。
- **macOS** 第一次打开会提示无法打开 ccUI：打开 **系统设置 → 隐私与安全性**，点击**仍要打开**（或运行一次
  `xattr -cr /Applications/ccUI.app`）。

### 从源码运行

```bash
git clone https://github.com/ShinyPoint/ccUI.git
cd ccUI
npm install
npm start          # 构建窗口，然后打开应用
```

要求：Node.js 20 或更高版本。不需要 C++ 工具链：终端模块（`@lydell/node-pty`）和 Claude Code 都是预编译的二进制文件。
从源码运行时，使用 Agent SDK 自带的 Claude Code 可执行文件。安装包不包含它：安装后的 ccUI 会在第一次开始会话时从 npm
下载 Claude Code（只需一次，约 135 MB），下载完成后会话自动开始。也可以在 设置 → Claude Code → 可执行文件 中指定其他
`claude` 版本。

## 功能

**对话会话**（基于 Claude Agent SDK，与 `claude` CLI 使用同一引擎）
- 回复以渲染后的 Markdown 流式呈现，代码带语法高亮。每个已完成的回答下方都有**复制**按钮，只复制回答本身，不含处理步骤。
- 每次工具调用占一行：*读取*、*编辑*（+12 −3）、*运行* `npm test`……点击一行查看详情：带行号的真实 diff、文件内容、命令
  输出、网页结果。子代理的步骤嵌套在启动它的那次调用下面。一轮处理结束后，步骤会折叠成一行（"用时 1m 12s · 8 个步骤"）。
- 权限请求出现在需要它的那一步上：**允许**、**允许，以后不再询问**（会明确显示将添加哪条规则），或**拒绝**并附一句话，
  告诉 Claude 应该改做什么。
- Claude 的选择题会变成表单；计划模式下的计划会显示为带**批准计划**按钮的卡片。
- 输入框支持 `/` 命令和 `@` 文件自动补全、粘贴和拖入图片、**Esc** 停止、**Shift+Tab** 切换权限模式；上下文圆环在
  Claude 工作时实时更新（点击可查看上下文窗口的占用、本次会话的费用，以及压缩对话）。
- 顶栏：点击项目名称展开项目文件夹列表（选择一个即在该文件夹中开始新对话），旁边是带推理强度滑块的模型菜单；文件夹按钮
  会在文件资源管理器或访达中打开项目。
- Claude 工作时发送的消息会标记为*排队中*，Claude 会在下一步读取。**停止**会结束本轮处理，并把排队的消息放回输入框。
- 对你发出的任意消息（悬停或右键）：**复制**、**编辑并重新发送**（回到这条消息之前重新发送，可选择同时撤销 Claude 此后的
  文件改动）、**撤销此后的文件改动**，以及**从这里分支到新对话**。
- 对话右侧的**改动**面板（Ctrl+Shift+D，或点击某一轮旁的 *N 个文件*）：这一轮改动的每个文件，可看 diff，也可看标出新增行
  的完整文件。
- 斜杠命令：`/` 列表包含所有命令。那些在 Claude Code CLI 中会打开交互界面的命令，在对话里以对话的方式呈现：`/btw` 回答
  一个题外问题而不加入对话；`/status`、`/memory`、`/mcp` 和 `/skills` 打开对话框；`/model`、`/effort`、`/context`、
  `/theme` 和 `/config` 打开对应的菜单或设置；`/export`、`/copy`、`/rename`、`/branch`、`/resume`、`/plan` 和 `/exit`
  直接执行。其余命令（`/hooks`、`/permissions`、`/agents`……）会提议在 CLI 中继续此对话，并帮你填好命令。
- 后台子代理：输入框上方的条栏列出 Claude 派出的子代理及各自正在做什么，可以停止其中一个或全部。
- 任务条跟踪 Claude 的待办清单，并显示每一轮和整个会话的费用。

**工作台**
- 多个会话并排运行，按项目分组。侧边栏的每张卡片都有实时活动曲线和状态：*处理中*、*等待你回复*、*待查看*、*就绪*。
  后台会话需要你时会发出桌面通知。
- **CLI** 按钮：在 Claude Code 自带的终端界面中继续同一对话（用于 `/login`、`!` bash 模式以及对话界面未覆盖的功能）。
  **对话**按钮：切回来。
- **终端**面板（Ctrl+`）：在会话的项目文件夹中打开的 shell，停靠在会话下方。Windows 上优先使用已安装的 PowerShell 7
  （`pwsh`），否则使用 Windows PowerShell；macOS 和 Linux 上使用你的登录 shell。
- 重新启动后会话会恢复，包括历史和标题；也可以继续某个文件夹中的任意历史对话。20 分钟没查看的对话会释放它的 Claude Code
  进程（每个约占几百 MB），再次选中时会在同一对话上重新启动。
- 深色和浅色主题，三种配色（中性的默认、粉色，以及陶土色：Claude 桌面版的暖色调），可调文字大小、毛玻璃效果，还可以设置
  自己的背景图片。窗口按钮、菜单、对话框和提示框都由应用自己绘制。
- 英文或简体中文界面，默认跟随系统，可在 设置 → 通用 中切换。
- 对话右侧的**消息导航**：鼠标移到右边缘，会显示你发送的每条消息在对话中的位置，点击即可跳转；展开的列表（也可以在
  空输入框中按 **Esc Esc**，和 Claude Code 一样）列出全部消息及其时间。鼠标移到任意消息上可以看到发送时间。
- 同一项目同时只保留一个未使用的新对话（以及一个未使用的新 CLI）：再新建时会直接切换到它。
- **界面缩放**（设置 → 外观），80%–150%，与对话文字大小分开调节。
- Claude Code 无需更新应用即可保持最新：设置 → Claude Code → 更新 会从 npm 获取最新版本，用其公布的 sha512 校验后
  用于新会话。也可以自己选择版本：最近的 10 个版本之一，或手动输入任意版本（设置 → Claude Code → 版本），指定的版本
  不会自动更新。

## 常见问题

**免费吗？使用要花钱吗？**
ccUI 免费开源（MIT 许可证）。Claude 本身的费用和 Claude Code 一样：对话会话使用 Anthropic API key（由 Anthropic 按用量
计费）或云服务；Claude.ai 订阅可在 CLI 视图中使用。见[账户与登录](#账户与登录)。

**能用我的 Claude Pro / Max 订阅吗？**
CLI 视图可以：它就是 Claude Code 自带的 CLI，使用它自己的登录。对话会话不行：Anthropic 不允许其他应用使用 Claude.ai
订阅登录。

**为什么第一次开始会话要下载东西？**
下载的是 Claude Code 本身（来自 Anthropic 的 npm 包，并用其公布的 sha512 校验）。不把它打进安装包，安装包能小一半左右，
还可以自选 Claude Code 版本（设置 → Claude Code → 版本）。如果你已经装了 Claude Code，也可以在 设置 → Claude Code →
可执行文件 中指定它。

**ccUI 会把我的数据发到别处吗？**
不会。应用自身的网络请求只有 npm 仓库，用于下载和更新 Claude Code；没有任何统计上报。你的对话由 Claude Code 发往
Anthropic 的 API（或你的云服务），并保存在 Claude Code 平常使用的文件夹（`~/.claude`）中，所以 `claude` CLI 也能看到
同样的会话。

**这是 Anthropic 做的吗？**
不是，ccUI 是独立项目。它运行 Anthropic 的 Claude Code 和 Agent SDK，适用 Anthropic 的条款。

**遇到问题怎么办？**
请[提交 issue](https://github.com/ShinyPoint/ccUI/issues)，写明你做了什么、发生了什么、你的系统和 ccUI 版本（设置中可以
看到），附截图更好。

## 账户与登录

对话会话使用 **Anthropic API 密钥**登录（设置 → 账户；通过系统钥匙串加密保存），或者使用 Claude Code 自身已配置的方式：
API 密钥、`ANTHROPIC_AUTH_TOKEN`、Amazon Bedrock、Google Vertex AI 或 Microsoft Foundry。

Anthropic 不允许第三方应用使用 Claude.ai 订阅登录（Pro/Max/Team/Enterprise）。如果 Claude Code 是这样登录的，对话会话
会说明这一点，并提议改在终端中打开此对话。终端会话运行官方的 Claude Code CLI，使用它自己的登录，和在任何终端应用里一样。

## 安全

- **文件夹信任。** 项目的 `.claude` 设置可以在 Claude Code 启动时就运行命令，所以在一个文件夹中第一次开始对话时，会先
  询问你是否信任它，和 Claude Code 自己的提示一样。已在 Claude Code 中信任过的文件夹及其子文件夹不会再次询问。
- **Claude 的输出被视为不可信内容。** 回复渲染时不含脚本、样式、表单和远程内容：图片只显示回复中内嵌的，链接只能指向
  网页，并在浏览器中打开。
- 窗口运行在沙盒中，它发出的每个请求都会被检查，且只能加载应用自身的文件。
- Claude 运行的命令会继承 Claude Code 的环境，包括设置中保存的 API 密钥。只在你信任的项目中批准命令（或使用*跳过权限确认*）。

## 快捷键

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 新建会话 | Ctrl+Shift+T | ⌘T |
| 结束会话 | Ctrl+Shift+W | ⌘W |
| 下一个 / 上一个会话 | Ctrl+Tab / Ctrl+Shift+Tab | 相同 |
| 跳转到会话 | Ctrl+1…9 | ⌘1…9 |
| 聚焦输入框 | Ctrl+Shift+K | ⌘⇧K |
| 在对话中查找（Enter / Shift+Enter：下一个 / 上一个） | Ctrl+F | ⌘F |
| 搜索项目和会话 | Ctrl+Shift+F（在侧边栏中也可用 Ctrl+F） | ⌘⇧F |
| 显示 / 隐藏改动面板（对话） | Ctrl+Shift+D | ⌘⇧D |
| 显示 / 隐藏终端面板 | Ctrl+` | ⌃` |
| 显示 / 隐藏侧边栏 | Ctrl+Shift+B | ⌘⇧B |
| 停止 Claude（对话） | Esc | Esc |
| 切换权限模式（对话） | Shift+Tab | Shift+Tab |
| 换行 | Shift+Enter | Shift+Enter |
| 终端中复制 / 粘贴 | Ctrl+C（有选中内容时）/ Ctrl+V（Windows），Ctrl+Shift+V（Linux） | ⌘C / ⌘V |
| 文字大小 | Ctrl+= / Ctrl+- / Ctrl+0 | ⌘+ / ⌘- / ⌘0 |
| 设置 | Ctrl+, | ⌘, |

## 开发

```bash
npm run dev        # Vite 开发服务器（热更新）+ Electron
npm start          # 生产构建窗口，然后启动 Electron
npm test           # 单元测试：对话 reducer、更新器、翻译（不需要网络）
npm run check      # 所有脚本化的端到端检查（见下文）；npm run check -- changes i18n 只运行其中几项
npm run shots      # 深色和浅色主题下的界面截图，保存在 dist/ui-shots/
npm run icon       # 根据 "cc" 字标重新绘制应用图标（assets/）
npm run video      # 录制介绍视频到 dist/intro-video/（脚本化，需要 ffmpeg）
```

`scripts/checks/` 中的端到端检查会驱动真实构建出的窗口，输出 PASS / FAIL，并把截图保存在 `dist/<检查名>/`。大部分检查用
`scripts/checks/fakes.js` 模拟 Claude，它发出的消息流与 Claude Code 相同，所以不产生费用，也不需要网络：

| 检查 | 覆盖内容 |
| --- | --- |
| `check:agents` | 后台子代理：输入框上方的条栏、停止其中一个、停止 |
| `check:changes` | 改动面板：diff、文件视图、调整宽度、窄窗口 |
| `check:look` | 对话的外观和动效、上下文圆环、回答下方的复制按钮 |
| `check:commands` | 斜杠命令：/btw、/status、/memory、/mcp、/export、/copy，以及仅限 CLI 的命令 |
| `check:dialogs` | 新建会话、文件夹信任、跳过权限确认和退出确认 |
| `check:effort` | 模型菜单的推理强度滑块、设置中的开关和滑块、配色 |
| `check:i18n` | 简体中文界面：没有残留英文、没有粗体、实时切换语言 |
| `check:select` | 拖动选择文字：只选中对话文字，不选中按钮和标签 |
| `check:sessions` | 重新启动、逐个读取历史、空闲对话的释放和唤醒、崩溃后重新加载 |

其余检查使用真实环境。`check:background`（对话、CLI 和终端中的背景图片）和 `check:skills`（/skills 对话框）会启动真实的
Claude Code，但不发送提示词；`check:update` 会从 npm 下载。以下检查**会发送提示词，产生几美分的费用**：`npm run smoke`、
`check:actions`、`check:find`、`npm run sdk-check`。

调试：`CCUI_RECORD=stream.jsonl npm start` 会保存每一条原始 SDK 消息，方便编写 reducer 测试。

在 Windows 上，`npm start` 和 `npm run dev` 会以 `ccUI.exe` 运行应用：它是本地 `electron.exe` 的副本，带有 ccUI 的名称和图标
（`scripts/launch.mjs`，每次安装 Electron 后生成一次），这样任务栏显示的是 ccUI 而不是 Electron。

### 翻译

应用显示的每个词都经过 `t('English text')`，以英文原文作为键。简体中文位于 `src/renderer/locales/zh-CN/`（菜单和原生对话框
的文字在 `src/main/i18n.js`）。缺少或多余的翻译会让 `npm test` 失败，界面上残留英文会让 `npm run check:i18n` 失败。新增一种
语言，就在 `zh-CN` 旁边新建一个文件夹，并在 `LANGUAGES`（`src/renderer/lib/i18n.js`）中加一项。

## 打包

```bash
npm run dist          # 为当前系统生成安装包，输出到 dist/
npm run dist:win      # NSIS 安装包 + 便携版 exe
npm run dist:mac      # dmg + zip（需在 macOS 上构建）
npm run dist:linux    # AppImage + deb
```

安装包不包含 Claude Code 可执行文件（首次使用时下载，见[快速开始](#快速开始)），Chromium 语言文件也只保留中英文：Windows
安装包约 110 MB。每个平台需要在该平台上构建：终端模块的预编译文件来自按系统区分的 npm 包，`npm install` 只会获取当前
系统的版本。

发布流程：Windows 安装包在本地构建，随 Release 一起发布；发布后会触发 `.github/workflows/release.yml`，在 GitHub 的
服务器上构建 macOS（Apple 芯片和 Intel，使用临时签名，暂无 Apple 开发者证书）和 Linux 安装包，上传到同一个 Release，
并把它们的校验值加入 `SHA256SUMS.txt`。分发构建产物之前，请阅读 Anthropic 关于 Claude Code 和 Agent SDK 的条款：
<https://code.claude.com/docs/en/legal-and-compliance>。

## 项目结构

```
src/main/             Electron 主进程
  main.js             窗口、IPC、应用菜单、对话框
  agent.js            对话会话：每个会话一个 Agent SDK 查询、消息队列、权限桥接、登录检查
  pty.js              终端和 shell 会话（node-pty）
  settings.js         JSON 设置；API 密钥用 Electron safeStorage 加密
  trust.js            在 Claude Code 启动前确认文件夹信任
  skills.js           /skills 对话框：列出技能并启用或停用
  claude-binary.js    决定使用哪个 Claude Code：内置的（最新版或指定的版本），或自定义的
  claude-update.js    下载、校验并安装 Claude Code：首次下载、更新、指定的版本
  files.js, background.js, shell-env.js, i18n.js
src/preload.js        窗口可以使用的小型桥接（上下文隔离 + 沙盒）
src/renderer/         窗口：Preact + signals，用 Vite 构建
  lib/chat-reducer.js SDK 消息流 → 时间线状态（纯函数，有单元测试）
  lib/sessions.js     会话生命周期、对话 ⇄ 终端切换、状态和通知
  lib/commands.js     对话中的斜杠命令
  components/         侧边栏、对话视图、工具卡片、提示、输入框、面板、对话框
  locales/            翻译
test/                 单元测试
scripts/              开发服务器、图标和截图工具
scripts/checks/       端到端检查，以及模拟 Claude 的脚本（fakes.js）
scripts/intro-video/  介绍视频，使用同一个模拟脚本录制
```

对话会话的状态来自 SDK 事件：正在进行的一轮是*处理中*，有待处理的权限请求或问题是*等待你回复*，你还没看过的已完成一轮是
*待查看*。终端会话没有结构化事件，状态根据输出推断（约 1.6 秒没有输出即视为在等待）。

## 反馈与贡献

- **问题和建议：** [Issues](https://github.com/ShinyPoint/ccUI/issues)。欢迎提功能建议，最好说明你想完成什么，而不只是
  要加什么。
- **更新内容：** 每个版本的说明见 [Releases](https://github.com/ShinyPoint/ccUI/releases)。
- **Pull request：** 欢迎。每个 pull request 只做一件事，提交前运行 `npm test` 和 `npm run check`（它们用脚本模拟
  Claude，不产生费用），新增的界面文字要补上简体中文（见[翻译](#翻译)）。较大的改动请先开 issue 讨论方案。
- 如果 ccUI 对你有用，点个 ⭐ 能让更多人看到它。

## 许可证

ccUI 以 [MIT 许可证](LICENSE)发布。

它运行的部分软件不在该许可证范围内：Claude Code（首次使用时从 npm 下载）和 Claude Agent SDK（包含在安装包中）属于
Anthropic，适用
[Anthropic 的条款](https://code.claude.com/docs/en/legal-and-compliance)。随附的字体（Instrument Sans、Instrument Serif、
JetBrains Mono）采用 SIL Open Font License，其他依赖各自采用其许可证（见 `node_modules`）。"Claude" 和 "Claude Code"
是 Anthropic 的商标。
