# ccUI

A desktop app for working with Claude Code. Sessions open as a **chat**: Claude's replies, every file edit as a
diff, every command with its output, and permission requests as buttons. Any session can switch to Claude Code's
own **terminal** interface and back, keeping the same conversation. Runs on Windows, macOS and Linux.

## Features

**Chat sessions** (built on the Claude Agent SDK, the same engine as the `claude` CLI)
- Replies stream in as rendered Markdown with highlighted code and copy buttons.
- Each tool call is one row: *Read*, *Edit* (+12 −3), *Run* `npm test`… Click a row for details: real diffs with
  line numbers, file contents, command output, web results. Subagents nest their steps under the call that started them.
- Permission requests appear on the step that needs them: **Allow**, **Allow and don't ask again** (shows exactly
  which rule gets added), or **Deny** with a note telling Claude what to do instead.
- Claude's multiple-choice questions become a form; plans (plan mode) get an **Approve plan** card.
- Message box with `/` command and `@` file autocomplete, image paste and drag-and-drop, **Esc** to stop,
  **Shift+Tab** to cycle permission modes, and model and mode menus.
- Messages sent while Claude works are marked *Queued*: Claude reads them at its next step. **Stop** stops the
  turn and cancels queued messages, which go back into the message box.
- Actions on any of your messages (hover, or right-click): **Copy**, **Edit and resend** (go back to before the
  message and send it again, optionally undoing Claude's file changes since), **Undo file changes since here**,
  and **Fork into a new chat**. The conversation as it was stays under Recents.
- A task strip that tracks Claude's to-do list, a context-usage meter, and cost per turn and per session.
- Resume any earlier conversation in a folder (*Continue latest* or *Pick one…*).

**Workbench**
- Several sessions side by side. Each sidebar card has a live activity trace and a state: *Working*,
  *Needs your answer*, *Waiting for you*, *Ready*. Desktop notifications fire when a background session needs you.
- **CLI** button: continue the same conversation in Claude Code's own command-line interface (for `/login`,
  `/config`, `!` bash mode and anything else the chat does not cover). **Chat** button: come back.
- **Terminal** panel (the panel button at the top right, or Ctrl+`): a shell in the session's project folder, docked under the
  session and resizable. It uses PowerShell 7 (`pwsh`) on Windows when installed, otherwise Windows PowerShell;
  your login shell on macOS and Linux. Each session keeps its shell running while the panel is hidden.
- Your sessions come back when you relaunch, with their history and titles. Only the one you had open starts
  right away; the others start when you click them (turn this off in Settings).
- Plain shell sessions, recent folders, renaming, dark and light themes, ten accent colors (black by default),
  adjustable text sizes. Frosted glass (Settings → Appearance) frosts the window frame and every menu and pop-up.
  The app draws its own window buttons and tooltips.
- Context at a glance: the ring in the message box opens what fills the context window, what the session has
  cost so far, and a button to compact the conversation.
- Skills in chat: type `/skills` to see every skill (yours, the project's, plugins', Claude Code's own), what each
  costs in context, and turn them on, name-only, /name-only or off, for this project or all projects. Commands that
  only work in Claude Code's CLI aren't sent to Claude as a message.
- **Changes** panel at the right of a chat (the button at the top right, Ctrl+Shift+D, the *N files* chip next to a
  turn's "Worked for…", or a file name in an edit): the files one turn changed, each as that turn's diff or as the
  whole file with the lines it added marked. Files outside the project folder aren't read.
- Background subagents: a strip above the message box lists the agents Claude sent off, what each is doing, and
  stops one (or all). The turn that sent them ends normally, and Claude's answer when one returns is marked.
- A background image of your own (Settings → Appearance): drawn blurred behind the whole window, with the
  panels, chat and terminals see-through over it; how much shows through and the blur are adjustable.
- Claude Code stays current without an app update (Settings → Claude Code → Updates): **Check for updates** and
  **Update automatically** (on by default; at launch and every 6 hours) fetch the newest build from npm, check it
  against its published sha512 and use it for new sessions. Running sessions keep the version they started with.

## Accounts and sign-in

Chat sessions authenticate with an **Anthropic API key** (Settings → Account; stored encrypted with the OS
keychain), or with whatever Claude Code itself is configured for: an API key, `ANTHROPIC_AUTH_TOKEN`, Amazon
Bedrock, Google Vertex AI or Microsoft Foundry.

Anthropic does not allow third-party apps to use Claude.ai subscription logins (Pro/Max/Team/Enterprise). If Claude
Code is signed in that way, a chat session says so and offers to open the conversation in the terminal instead.
Terminal sessions run the official Claude Code CLI with its own sign-in, the same as in any terminal app.

## Safety

- **Folder trust.** A project's `.claude` settings can run commands as soon as Claude Code starts in it, so the first
  chat in a folder asks whether you trust it (like Claude Code's own prompt). Folders you already trusted in Claude
  Code, and folders inside a trusted one, are not asked about again.
- **Claude's output is treated as untrusted.** Replies are rendered without scripts, styles, forms or remote content:
  images only when embedded in the reply, links only to the web, opened in your browser.
- The window is sandboxed, every request from it is checked, and it can only load the app's own files.
- Commands Claude runs inherit Claude Code's environment, including an API key saved in Settings. Approve commands
  (or use *Bypass permissions*) only in projects you trust.

## Requirements

- Node.js 20+ to build or run from source. End users of a packaged build need nothing else: the Claude Code
  executable ships inside the app (from the Agent SDK's platform package).
- Optional: point Settings → Claude Code → Executable at another `claude` build.

No C++ toolchain is needed. The pty module (`@lydell/node-pty`) and Claude Code come as prebuilt binaries.

## Develop and run

```bash
npm install
npm run dev        # Vite dev server with hot reload + Electron
npm start          # production build of the window, then Electron
npm test           # reducer unit tests (no network)
npm run shots      # screenshots of the UI in dark and light themes, in dist/ui-shots/ (no API usage)
npm run icon       # redraws the app icon (assets/icon.png) from the "cc" wordmark
npm run smoke      # end-to-end: real Claude session on Haiku in a temp folder, screenshots in dist/smoke/ (costs a few cents)
npm run check:actions  # end-to-end: Stop with a queued message, edit and resend with file undo, fork (Haiku, a few cents)
npm run check:find     # end-to-end: Find in chat and the project search (Haiku, about a cent)
npm run check:background  # background image: choose/remove, applied in chat, CLI and Terminal, screenshots (no API usage)
npm run check:look        # chat look and motion: bubbles, easing to new lines, Terminal joined to the chat (scripted, no API usage)
npm run check:skills      # /skills in a chat: list, turn a project skill off and on, CLI-only commands (real Claude Code, no prompts sent)
npm run check:select      # drag-selecting text in a chat: only conversation text, not buttons or labels (scripted, no API)
npm run check:update      # Claude Code updates: check, download, verify and use the newest build (real npm download, no API)
npm run check:agents      # background subagents: the strip above the message box, stopping one, Stop, nothing left "working" (scripted, no API)
npm run check:changes     # the Changes panel: a turn's files, their diffs, the file with added lines marked (scripted, no API)
npm run check:dialogs     # New session, folder trust, Bypass and quit confirmations as in-app dialogs (scripted, no API)
npm run video      # records the intro video in dist/intro-video/ccui-intro.mp4 (scripted session, no API usage; needs ffmpeg)
npm run sdk-check  # checks the Agent SDK features the app relies on (costs a few tens of cents)
```

## Package

```bash
npm run dist          # installers for the current OS, written to dist/
npm run dist:win      # NSIS installer + portable exe
npm run dist:mac      # dmg + zip (build on macOS)
npm run dist:linux    # AppImage + deb
```

Build each platform on that platform: the Claude Code executable comes from an OS-specific npm package that
`npm install` only fetches for the current OS. Expect installers of roughly 250 MB, most of it the Claude Code
executable. Before distributing builds publicly, review Anthropic's terms for the bundled Claude Code binary:
<https://code.claude.com/docs/en/legal-and-compliance>.

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
| Show / hide Terminal panel | Ctrl+` | ⌃` |
| Toggle sidebar | Ctrl+Shift+B | ⌘⇧B |
| Stop Claude (chat) | Esc | Esc |
| Cycle permission mode (chat) | Shift+Tab | Shift+Tab |
| New line | Shift+Enter | Shift+Enter |
| Copy / paste in terminal | Ctrl+C (with a selection) / Ctrl+V (Windows), Ctrl+Shift+V (Linux) | ⌘C / ⌘V |
| Text size | Ctrl+= / Ctrl+- / Ctrl+0 | ⌘+ / ⌘- / ⌘0 |
| Settings | Ctrl+, | ⌘, |

## How it works

```
src/main/
  main.js           window, IPC, dialogs
  agent.js          chat sessions: one Agent SDK query per session, message queue, permission bridge, sign-in check
  pty.js            terminal and shell sessions (node-pty)
  claude-binary.js  finds the built-in Claude Code executable (shipped or updated), or a custom one
  claude-update.js  downloads, verifies and installs newer Claude Code builds into the app's data folder
  shell-env.js      imports the login-shell PATH on macOS/Linux; strips nested-Claude markers from child env
  files.js          project file list for @-mentions (git ls-files, or a folder walk)
  settings.js       JSON settings; API key encrypted with Electron safeStorage
src/preload.js      the small bridge the window may use (context isolation + sandbox)
src/renderer/
  lib/chat-reducer.js   SDK message stream → timeline state (pure, unit-tested)
  lib/sessions.js       session lifecycle, chat ⇄ terminal switching, status and notifications
  components/           Preact UI: sidebar, chat view, tool cards, prompts, composer, dialogs
test/               reducer and updater tests
scripts/            dev server, smoke test, SDK check
```

A chat session's state comes from SDK events: a turn in progress means *Working*, an open permission request or
question means *Needs your answer*, and a finished turn you haven't looked at means *Waiting for you*. Terminal
sessions have no structured events, so their state is inferred from output (about 1.6 s of quiet means waiting).

Debugging: `CCUI_RECORD=stream.jsonl npm start` saves every raw SDK message, which is handy for writing new reducer tests.
