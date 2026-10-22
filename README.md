<div align="center">

<img src="assets/icon.png" width="128" alt="ccUI">

<h1>ccUI</h1>

<p><b>Claude Code, as a desktop app.</b></p>

<p>Every edit as a diff, every permission as a button, many sessions side by side,<br>
and Claude Code's own CLI one click away, on the same conversation.</p>

<p>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/ShinyPoint/ccUI?style=flat-square&color=D97757&label=release"></a>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-D97757?style=flat-square"></a>
<img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-1D1D1F?style=flat-square">
<img alt="Electron" src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white">
<img alt="Claude Agent SDK" src="https://img.shields.io/badge/Claude%20Agent%20SDK-0.3-D97757?style=flat-square&logo=anthropic&logoColor=white">
<img alt="English and Simplified Chinese" src="https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-1D1D1F?style=flat-square">
</p>

<p><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

<p>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-D97757?style=for-the-badge&logo=windows&logoColor=white"></a>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS-D97757?style=for-the-badge&logo=apple&logoColor=white"></a>
<a href="https://github.com/ShinyPoint/ccUI/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux-D97757?style=for-the-badge&logo=linux&logoColor=white"></a>
</p>

<img src="docs/demo.gif" width="100%" alt="ccUI in use: a chat where Claude reads files and edits them as diffs, a permission asked as buttons, and the same conversation continued in the CLI">

</div>

> [!NOTE]
> ccUI is an independent project. It is not made, endorsed or supported by Anthropic.

## Highlights

<table>
<tr>
<td width="50%" valign="top"><img src="docs/permissions.jpg" alt="A permission prompt with Allow, Allow and don't ask again, and Deny, and the task list below it"><br>
<b>Permissions are buttons.</b> Allow once, allow and don't ask again (it shows the exact rule), or deny with a note
that tells Claude what to do instead. Claude's task list follows along above the message box.</td>
<td width="50%" valign="top"><img src="docs/question.jpg" alt="Claude's multiple-choice question shown as a form"><br>
<b>Questions become forms.</b> Claude's multiple-choice questions, plans to approve, and every step it takes as one
readable row: what it read, searched, changed and ran.</td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/cli.jpg" alt="The same conversation in Claude Code's own CLI"><br>
<b>The real CLI, one click away.</b> Continue the same conversation in Claude Code's own terminal interface, then
come back to the chat. A shell in the project folder is docked under every session too.</td>
<td width="50%" valign="top"><img src="docs/theme.jpg" alt="The Clay color theme over a background image"><br>
<b>Make it yours.</b> Dark or light, the warm Clay palette of Claude's desktop app, frosted glass, your own
background image, and an interface in English or Simplified Chinese.</td>
</tr>
</table>

## Contents

- [Getting started](#getting-started)
- [Features](#features)
- [FAQ](#faq)
- [Accounts and sign-in](#accounts-and-sign-in)
- [Safety](#safety)
- [Keyboard](#keyboard)
- [Development](#development)
- [Packaging](#packaging)
- [Project layout](#project-layout)
- [Feedback and contributing](#feedback-and-contributing)
- [License](#license)

## Getting started

### Download

Get the newest build from [Releases](https://github.com/ShinyPoint/ccUI/releases/latest):

| System | File | |
| --- | --- | --- |
| Windows 10 / 11 (x64) | `ccUI-Setup-<version>-x64.exe` | Installer. Or `…-portable.exe`, which runs without installing |
| macOS 12+ (Apple Silicon) | `ccUI-<version>-mac-arm64.dmg` | Open it and drag ccUI into Applications |
| macOS 12+ (Intel) | `ccUI-<version>-mac-x64.dmg` | |
| Linux (x64) | `ccUI-<version>-linux-x86_64.AppImage` or `…-linux-amd64.deb` | AppImage: `chmod +x`, then run it |

**The first session takes a minute:** the installers don't include Claude Code, so ccUI downloads it from npm the
first time a session starts (about 135 MB, once) and shows how far along it is. Then sign in: see
[Accounts and sign-in](#accounts-and-sign-in).

The builds are not code-signed yet:
- **Windows** SmartScreen may say "Windows protected your PC": choose **More info → Run anyway**.
- **macOS** says ccUI "cannot be opened" the first time: open **System Settings → Privacy & Security** and choose
  **Open Anyway** (or run `xattr -cr /Applications/ccUI.app` once).

### From source

```bash
git clone https://github.com/ShinyPoint/ccUI.git
cd ccUI
npm install
npm start          # builds the window, then opens the app
```

Requirements: Node.js 20 or newer. No C++ toolchain is needed: the terminal module (`@lydell/node-pty`) and Claude
Code come as prebuilt binaries. Run from source, the app uses the Claude Code executable that comes with the Agent
SDK. The installers leave it out: an installed ccUI downloads Claude Code from npm the first time a session starts
(once, about 135 MB), and the session starts when it is in place. Settings → Claude Code → Executable can point at
another `claude` build instead.

## Features

**Chat sessions** (built on the Claude Agent SDK, the same engine as the `claude` CLI)
- Replies stream in as rendered Markdown with highlighted code. Each finished answer has a **Copy** button under it
  that takes the answer alone, without the steps.
- Each tool call is one row: *Read*, *Edit* (+12 −3), *Run* `npm test`… Click a row for details: real diffs with
  line numbers, file contents, command output, web results. Subagents nest their steps under the call that started
  them. A finished turn folds its steps into one line ("Worked for 1m 12s · 8 steps").
- Permission requests appear on the step that needs them: **Allow**, **Allow and don't ask again** (shows exactly
  which rule gets added), or **Deny** with a note telling Claude what to do instead.
- Claude's multiple-choice questions become a form; plans (plan mode) get an **Approve plan** card.
- Message box with `/` command and `@` file autocomplete, image paste and drag-and-drop, **Esc** to stop,
  **Shift+Tab** to cycle permission modes, and a context ring that follows the conversation while Claude works
  (click it for what fills the context window, the session's cost, and Compact).
- The top bar: the project's name opens the list of project folders (choosing one starts a new chat there), then
  the model menu with its effort slider; the folder button opens the project in File Explorer or Finder.
- Messages sent while Claude works are marked *Queued*: Claude reads them at its next step. **Stop** ends the turn
  and puts queued messages back into the message box.
- Actions on any of your messages (hover, or right-click): **Copy**, **Edit and resend** (go back to before the
  message and send it again, optionally undoing Claude's file changes since), **Undo file changes since here**, and
  **Fork into a new chat**.
- **Changes** panel at the right of a chat (Ctrl+Shift+D, or the *N files* chip on a turn): each file the turn
  changed, as its diff or as the whole file with the added lines marked.
- Slash commands: the `/` list has every command. Those that draw a screen in Claude Code's CLI are shown the chat's
  way: `/btw` answers a side question without adding it to the conversation; `/status`, `/memory`, `/mcp` and
  `/skills` open a dialog; `/model`, `/effort`, `/context`, `/theme` and `/config` open the matching menu or
  Settings; `/export`, `/copy`, `/rename`, `/branch`, `/resume`, `/plan` and `/exit` do what they say. The rest
  (`/hooks`, `/permissions`, `/agents`…) offer to continue the conversation in the CLI with the command typed in.
- Background subagents: a strip above the message box lists the agents Claude sent off, what each is doing, and
  stops one or all.
- A task strip that tracks Claude's to-do list, and the cost of each turn and of the session.

**Workbench**
- Several sessions side by side, grouped by project. Each sidebar card has a live activity trace and a state:
  *Working*, *Needs your answer*, *Waiting for you*, *Ready*. Desktop notifications fire when a background session
  needs you.
- **CLI** button: continue the same conversation in Claude Code's own terminal interface (for `/login`, `!` bash
  mode and anything else the chat doesn't cover). **Chat** button: come back.
- **Terminal** panel (Ctrl+`): a shell in the session's project folder, docked under the session. PowerShell 7
  (`pwsh`) on Windows when installed, otherwise Windows PowerShell; your login shell on macOS and Linux.
- Sessions come back when you relaunch, with their history and titles; resume any earlier conversation in a folder.
  A chat you haven't looked at for 20 minutes lets its Claude Code process go (it holds a few hundred MB) and starts
  it again on the same conversation when you select it.
- Dark and light themes in three color themes (neutral Default, Pink, and Clay: Claude's warm desktop palette),
  adjustable text sizes, frosted glass, and a background image of your own. The app draws its own window buttons,
  menus, dialogs and tooltips.
- English or Simplified Chinese (简体中文), following the system until you pick one in Settings → General.
- **Your messages** along the chat's right edge: point there for a mark per message, where it sits in the
  conversation, and click one to jump to it; the list (also **Esc Esc** in the empty message box, as in Claude Code)
  shows them all with their times. Point at any message to see when it was sent.
- A project keeps one unused new chat (and one unused new CLI) at a time: asking for another shows that one.
- **UI scale** (Settings → Appearance), 80–150%, besides the chat's text size.
- Claude Code stays current without an app update: Settings → Claude Code → Updates fetches the newest build from
  npm, checks it against its published sha512 and uses it for new sessions. Or choose the version yourself, one of
  the ten most recent or any other typed in (Settings → Claude Code → Version); a chosen version is not updated.

## FAQ

**Is it free? What does it cost to use?**
ccUI is free and open source (MIT). Claude itself is paid the way Claude Code is: chat sessions use an Anthropic API
key (billed by Anthropic per use) or a cloud provider; Claude.ai subscriptions work in the CLI view. See
[Accounts and sign-in](#accounts-and-sign-in).

**Can I use my Claude Pro / Max subscription?**
In the CLI view, yes: it is Claude Code's own CLI with its own login. Chat sessions can't: Anthropic doesn't allow
other apps to use a Claude.ai subscription login.

**Why does the first session download something?**
That is Claude Code itself (from Anthropic's npm package, checked against its published sha512). Leaving it out of
the installers makes them about half the size, and lets you choose its version (Settings → Claude Code → Version).
If you already have Claude Code installed, Settings → Claude Code → Executable can point at it instead.

**Does ccUI send my data anywhere?**
No. The app's own network traffic is the npm registry, to download and update Claude Code; there is no telemetry.
Your conversations go where Claude Code sends them (Anthropic's API, or your cloud provider) and stay in Claude
Code's usual folders (`~/.claude`), so the `claude` CLI sees the same sessions.

**Is this made by Anthropic?**
No, ccUI is an independent project. It runs Anthropic's Claude Code and Agent SDK, under Anthropic's terms.

**Something doesn't work.**
Please [open an issue](https://github.com/ShinyPoint/ccUI/issues) with what you did, what happened, your system
and the ccUI version (Settings shows it). A screenshot helps.

## Accounts and sign-in

Chat sessions authenticate with an **Anthropic API key** (Settings → Account; stored encrypted with the OS keychain),
or with whatever Claude Code itself is configured for: an API key, `ANTHROPIC_AUTH_TOKEN`, Amazon Bedrock, Google
Vertex AI or Microsoft Foundry.

Anthropic does not allow third-party apps to use Claude.ai subscription logins (Pro/Max/Team/Enterprise). If Claude
Code is signed in that way, a chat session says so and offers to open the conversation in the terminal instead.
Terminal sessions run the official Claude Code CLI with its own sign-in, the same as in any terminal app.

## Safety

- **Folder trust.** A project's `.claude` settings can run commands as soon as Claude Code starts in it, so the first
  chat in a folder asks whether you trust it, like Claude Code's own prompt. Folders you already trusted in Claude
  Code, and folders inside a trusted one, are not asked about again.
- **Claude's output is treated as untrusted.** Replies are rendered without scripts, styles, forms or remote content:
  images only when embedded in the reply, links only to the web, opened in your browser.
- The window is sandboxed, every request from it is checked, and it can only load the app's own files.
- Commands Claude runs inherit Claude Code's environment, including an API key saved in Settings. Approve commands
  (or use *Bypass permissions*) only in projects you trust.

## Keyboard

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| New session | Ctrl+Shift+T | ⌘T |
| End session | Ctrl+Shift+W | ⌘W |
| Next / previous session | Ctrl+Tab / Ctrl+Shift+Tab | same |
| Jump to session | Ctrl+1…9 | ⌘1…9 |
| Focus the message box | Ctrl+Shift+K | ⌘⇧K |
| Find in chat (Enter / Shift+Enter: next / previous) | Ctrl+F | ⌘F |
| Search projects and sessions | Ctrl+Shift+F (or Ctrl+F in the sidebar) | ⌘⇧F |
| Show / hide changed files (chat) | Ctrl+Shift+D | ⌘⇧D |
| Show / hide Terminal panel | Ctrl+` | ⌃` |
| Toggle sidebar | Ctrl+Shift+B | ⌘⇧B |
| Stop Claude (chat) | Esc | Esc |
| Cycle permission mode (chat) | Shift+Tab | Shift+Tab |
| New line | Shift+Enter | Shift+Enter |
| Copy / paste in terminal | Ctrl+C (with a selection) / Ctrl+V (Windows), Ctrl+Shift+V (Linux) | ⌘C / ⌘V |
| Text size | Ctrl+= / Ctrl+- / Ctrl+0 | ⌘+ / ⌘- / ⌘0 |
| Settings | Ctrl+, | ⌘, |

## Development

```bash
npm run dev        # Vite dev server with hot reload + Electron
npm start          # production build of the window, then Electron
npm test           # unit tests: the chat reducer, the updater, the translations (no network)
npm run check      # every scripted end-to-end check (see below); npm run check -- changes i18n runs some
npm run shots      # screenshots of the UI in dark and light themes, in dist/ui-shots/
npm run icon       # redraws the app icon (assets/) from the "cc" wordmark
npm run video      # records the intro video into dist/intro-video/ (scripted, needs ffmpeg)
```

The end-to-end checks in `scripts/checks/` drive the real built window and print PASS / FAIL lines, with screenshots
in `dist/<check>/`. Most of them script Claude with `scripts/checks/fakes.js`, which emits the same message stream
Claude Code does, so they cost nothing and need no network:

| Check | Covers |
| --- | --- |
| `check:agents` | background subagents: the strip above the message box, stopping one, Stop |
| `check:changes` | the Changes panel: diffs, the file view, resizing, a narrow window |
| `check:look` | chat look and motion, the context ring, Copy under an answer |
| `check:commands` | slash commands: /btw, /status, /memory, /mcp, /export, /copy, CLI-only ones |
| `check:dialogs` | New session, folder trust, Bypass and quit confirmations |
| `check:effort` | the model menu's effort slider, Settings switches and sliders, color themes |
| `check:i18n` | the app in Simplified Chinese: nothing left in English, no bold, switching live |
| `check:select` | drag-selecting text: only conversation text, not buttons or labels |
| `check:sessions` | relaunch, histories read one at a time, idle chats let go and woken, crash reload |

Others use the real thing. `check:background` (the background image in chat, CLI and Terminal) and `check:skills`
(the /skills dialog) start the real Claude Code without sending prompts; `check:update` downloads from npm. These
**send prompts and cost a few cents**: `npm run smoke`, `check:actions`, `check:find`, `npm run sdk-check`.

Debugging: `CCUI_RECORD=stream.jsonl npm start` saves every raw SDK message, which is handy for writing reducer tests.

On Windows, `npm start` and `npm run dev` run the app as `ccUI.exe`, a copy of the local `electron.exe` with the
ccUI name and icon (`scripts/launch.mjs`, made once per Electron install), so the taskbar shows ccUI rather than
Electron.

### Translations

Every word the app shows goes through `t('English text')`; the English is the key. Simplified Chinese lives in
`src/renderer/locales/zh-CN/` (and `src/main/i18n.js` for the menu and native dialogs). `npm test` fails on a missing
or unused translation, and `npm run check:i18n` on English left on screen. A new language is a new folder next to
`zh-CN` plus an entry in `LANGUAGES` (`src/renderer/lib/i18n.js`).

## Packaging

```bash
npm run dist          # installers for the current OS, written to dist/
npm run dist:win      # NSIS installer + portable exe
npm run dist:mac      # dmg + zip (build on macOS)
npm run dist:linux    # AppImage + deb
```

The installers leave out the Claude Code executable (it is downloaded on first use, see
[Getting started](#getting-started)) and keep only the English and Chinese Chromium language files: about
110 MB on Windows. Build each platform on that platform: the terminal module's prebuilt binary comes from an
OS-specific npm package that `npm install` only fetches for the current OS.

Releases: the Windows installers are built locally and published with the release; publishing it starts
`.github/workflows/release.yml`, which builds the macOS (Apple Silicon and Intel, signed ad-hoc: there is no Apple
Developer ID yet) and Linux installers on GitHub's runners, uploads them to the same release and adds their
checksums to its `SHA256SUMS.txt`. Before distributing builds, read Anthropic's terms for Claude Code and the Agent
SDK: <https://code.claude.com/docs/en/legal-and-compliance>.

## Project layout

```
src/main/             Electron main process
  main.js             window, IPC, app menu, dialogs
  agent.js            chat sessions: one Agent SDK query per session, message queue, permission bridge, sign-in check
  pty.js              terminal and shell sessions (node-pty)
  settings.js         JSON settings; API key encrypted with Electron safeStorage
  trust.js            folder trust before Claude Code starts in a folder
  skills.js           the /skills dialog: listing skills and turning them on or off
  claude-binary.js    finds the Claude Code to run: the built-in one (the newest, or the version chosen), or a custom one
  claude-update.js    downloads, verifies and installs Claude Code: the first one, updates, a chosen version
  files.js, background.js, shell-env.js, i18n.js
src/preload.js        the small bridge the window may use (context isolation + sandbox)
src/renderer/         the window: Preact + signals, built with Vite
  lib/chat-reducer.js SDK message stream → timeline state (pure, unit-tested)
  lib/sessions.js     session lifecycle, chat ⇄ terminal switching, status and notifications
  lib/commands.js     slash commands in a chat
  components/         sidebar, chat view, tool cards, prompts, composer, panels, dialogs
  locales/            translations
test/                 unit tests
scripts/              dev server, icon and screenshot tools
scripts/checks/       end-to-end checks and the scripted stand-in for Claude (fakes.js)
scripts/intro-video/  the intro video, recorded with the same stand-in
```

A chat session's state comes from SDK events: a turn in progress means *Working*, an open permission request or
question means *Needs your answer*, and a finished turn you haven't looked at means *Waiting for you*. Terminal
sessions have no structured events, so their state is inferred from output (about 1.6 s of quiet means waiting).

## Feedback and contributing

- **Bugs and ideas:** [Issues](https://github.com/ShinyPoint/ccUI/issues). Feature requests are welcome; tell what
  you were trying to do, not only what to add.
- **What changed:** each version's notes are on [Releases](https://github.com/ShinyPoint/ccUI/releases).
- **Pull requests:** welcome. Keep one change per pull request, run `npm test` and `npm run check` (they use a
  scripted stand-in for Claude, so they cost nothing), and add the Simplified Chinese for any new text (see
  [Translations](#translations)). For anything large, open an issue first so we can agree on the approach.
- If ccUI is useful to you, a ⭐ helps others find it.

## License

ccUI is released under the [MIT License](LICENSE).

It runs software that is not covered by that license: Claude Code (downloaded from npm on first use) and the Claude
Agent SDK (in the installers) are Anthropic's, under [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance). The bundled
fonts (Instrument Sans, Instrument Serif, JetBrains Mono) are under the SIL Open Font License, and the other
dependencies under their own licenses (see `node_modules`). "Claude" and "Claude Code" are trademarks of Anthropic.
