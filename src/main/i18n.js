// The main process's own words (the app menu, its few dialogs, errors it sends the window) in the language set
// in Settings → General: like renderer/lib/i18n.js, the English text is the key and `{name}` is filled from `vars`.
const ZH = {
  'This system has no secure storage for the key.': '这台电脑没有可用的安全存储，无法保存密钥。',
  // The app menu (macOS) and the system's own dialogs
  View: '显示',
  Cancel: '取消',
  'End sessions and quit': '结束会话并退出',
  '1 session is still running.': '还有 1 个会话在运行。',
  '{n} sessions are still running.': '还有 {n} 个会话在运行。',
  'Quitting ends them. Conversations are saved, so you can continue them later.': '退出会结束它们。对话已保存，之后可以继续。',
  'Trust this folder': '信任此文件夹',
  'Do you trust the files in this folder?': '你信任此文件夹中的文件吗？',
  'Claude Code will be able to read, edit and run files here. A project’s settings can also run commands as soon as a session starts. Only trust folders you created or whose contents you know.':
    'Claude Code 将能读取、编辑和运行这里的文件。项目的设置也能在会话启动时立即运行命令。只信任你自己创建或清楚其内容的文件夹。',
  'Choose a project folder': '选择项目文件夹',
  'Export the conversation': '导出对话',
  'Choose a background image': '选择背景图片',
  Images: '图片',
  // Errors the window shows
  'No version reported': '未返回版本号',
  'Folder not found: {path}': '找不到文件夹：{path}',
  'The folder for chats could not be made: {error}': '无法创建对话文件夹：{error}',
  'Claude Code did not list its plugins.': 'Claude Code 没有列出插件。',
  'Not a plugin name: {name}': '不是有效的插件名：{name}',
  'Nothing to do.': '没有要做的操作。',
  'Chat sessions need a Claude Code executable (claude.exe or claude), not a command name or a .cmd script. Choose one in Settings, or leave the setting empty to use the built-in Claude Code.':
    '对话会话需要 Claude Code 可执行文件（claude.exe 或 claude），不能是命令名或 .cmd 脚本。请在设置中选择一个，或留空以使用内置的 Claude Code。',
  'You did not trust this folder, so Claude Code was not started there.': '你没有信任此文件夹，所以没有在这里启动 Claude Code。',
  'Session is not running.': '会话没有在运行。',
  'Session closed.': '会话已关闭。',
  'Nothing to save.': '没有可保存的内容。',
  'Not an instructions file.': '这不是指令文件。',
  'No task given.': '没有指定任务。',
  'No question given.': '没有输入问题。',
  'No name given.': '没有输入名称。',
  'This message is not in the saved conversation, so it cannot be used as a starting point.': '这条消息不在已保存的对话中，所以不能作为起点。',
  'Choose a PNG, JPEG, WebP, GIF, AVIF or BMP image.': '请选择 PNG、JPEG、WebP、GIF、AVIF 或 BMP 图片。',
  'That image is larger than 40 MB.': '这张图片大于 40 MB。',
  'The image could not be copied: {error}': '无法复制图片：{error}',
  '{file} isn\'t valid JSON, so it was left alone. Fix it and try again.': '{file} 不是有效的 JSON，所以没有改动它。修好后再试。',
  'This argument cannot be passed to Claude Code through cmd.exe: {argument}': '这个参数无法通过 cmd.exe 传给 Claude Code：{argument}',
  // Claude Code updates
  'The download ended early.': '下载意外中断。',
  'The npm registry answered {status}.': 'npm 仓库返回了 {status}。',
  'No Claude Code build for this computer was found.': '没有找到适用于这台电脑的 Claude Code 版本。',
  'The registry sent an unexpected answer.': 'npm 仓库返回了无法识别的结果。',
  'The download failed ({status}).': '下载失败（{status}）。',
  'The download did not match its published checksum, so it was not used.': '下载的文件与发布的校验值不符，所以没有使用。',
  'The download has no Claude Code in it.': '下载的文件中没有 Claude Code。',
  'The new Claude Code did not start.': '新版本的 Claude Code 无法启动。',
  'There is no Claude Code {version} on npm for this computer.': 'npm 上没有适用于这台电脑的 Claude Code {version}。',
  'A version looks like 2.1.300.': '版本号的格式类似 2.1.300。',
  'Claude Code could not be downloaded: {reason}': '无法下载 Claude Code：{reason}',
  'unknown error': '未知错误',
};

let current = 'en';

// `setting`: 'system' | 'en' | 'zh-CN'; `system`: the OS locale (app.getLocale()).
function setLanguage(setting, system) {
  current = setting === 'en' || setting === 'zh-CN' ? setting : /^zh/i.test(system || '') ? 'zh-CN' : 'en';
}

function t(text, vars) {
  const out = (current === 'zh-CN' && ZH[text]) || text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

module.exports = { t, setLanguage, ZH, language: () => current };
