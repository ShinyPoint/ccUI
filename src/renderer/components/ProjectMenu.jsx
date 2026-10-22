// The project a session works in, as a menu of the folders in use and recently opened: choosing one starts a new
// chat there. Shown in the top bar, and on a new chat above the message box (`chip`: with a folder icon).
import { Icon, Menu, openContextMenu } from './ui.jsx';
import { api, sessions, settings, toast } from '../lib/store.js';
import { openSession, chooseFolderAndStart } from '../lib/sessions.js';
import { basename, tildify, samePath, fileManagerLabel } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const PICK = '\u0000pick';

export function ProjectMenu({ s, proc, chip = false }) {
  const folders = [];
  for (const p of [s.cwd, ...sessions.value.map((x) => x.cwd), ...(settings.value.recent || []).map((r) => r.path)]) {
    if (p && !folders.some((f) => samePath(f, p))) folders.push(p);
  }
  return (
    <div class="no-drag" onContextMenu={(e) => openContextMenu(e, [
      { label: fileManagerLabel(), run: () => api.openPath(s.cwd) },
      { label: t('Copy path'), run: () => { api.writeClipboard(s.cwd); toast(t('Path copied.')); } },
    ])}>
      <Menu
        className={chip ? 'project-menu intro-chip' : 'project-menu'}
        title={`${tildify(s.cwd)}\n${t('Switch project: a new chat in another folder')}${proc ? `\n${proc}` : ''}`}
        up={false}
        label={<>{chip && <Icon name="folder" size={15} />}<span class="menu-text">{basename(s.cwd)}</span></>}
        value={s.cwd}
        options={[
          ...folders.map((path) => ({ value: path, label: basename(path), hint: tildify(path) })),
          { value: PICK, label: t('Open folder…') },
        ]}
        onSelect={(path) => (path === PICK ? chooseFolderAndStart() : openSession({ cwd: path, kind: 'chat' }))}
      />
    </div>
  );
}
