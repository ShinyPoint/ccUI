// Plugins: Claude Code's plugins, managed through its own `claude plugin` commands (what /plugin does in its CLI),
// so the app and the CLI always agree. Installed: each on or off, what it adds, an update, removal. Discover: what
// the added marketplaces offer, to install; marketplaces added and refreshed. Open chats pick a change up at once,
// CLI sessions when started again.
import { useEffect, useState } from 'preact/hooks';
import { Dialog, Segmented, Icon, Switch, Collapse } from '../ui.jsx';
import { api, active, sessions, pluginsDialog, toast, confirmDialog } from '../../lib/store.js';
import { t, phrase } from '../../lib/i18n.js';

const SCOPES = { user: phrase('All projects'), project: phrase('This project'), local: phrase('This project, just you') };
const cwd = () => active.value?.cwd;
const nameOf = (id = '') => id.split('@')[0];

function reloadChats() {
  for (const s of sessions.value) if (s.agentId) api.agent.control(s.agentId, 'reload-plugins').catch(() => {});
}

// What `claude plugin details` says it adds and costs (Claude Code's own words), shown when opened.
function Details({ id }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let live = true;
    api.plugins.run({ action: 'details', id, cwd: cwd() }).then((res) => { if (live) setText(res.ok ? res.text : res.error); });
    return () => { live = false; };
  }, [id]);
  return <pre class="plugin-details">{text || t('Loading…')}</pre>;
}

function Installed({ p, busy, run }) {
  const [open, setOpen] = useState(false);
  const meta = [p.version, p.id.split('@')[1], SCOPES[p.scope] ? t(SCOPES[p.scope]) : p.scope].filter(Boolean).join(' · ');
  return (
    <li class={`skill plugin ${p.enabled ? '' : 'off'}`}>
      <div class="plugin-row">
        <div class="skill-text">
          <div class="skill-name"><span>{nameOf(p.id)}</span><span class="skill-tokens">{meta}</span></div>
          {p.description && <div class="skill-desc" title={p.description}>{p.description}</div>}
        </div>
        <div class="skill-actions">
          <button type="button" class={`icon-btn plugin-more ${open ? 'open' : ''}`} title={t('What it adds')} aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="chevron" size={14} />
          </button>
          <button type="button" class="icon-btn" title={t('Update')} disabled={busy} onClick={() => run('update', p.id)}><Icon name="refresh" size={14} /></button>
          <button type="button" class="icon-btn" title={t('Uninstall')} disabled={busy} onClick={() => run('uninstall', p.id)}><Icon name="x" size={14} /></button>
          <Switch checked={p.enabled} disabled={busy} label={t('Use {name}', { name: nameOf(p.id) })}
                  onChange={(on) => run(on ? 'enable' : 'disable', p.id)} />
        </div>
      </div>
      <Collapse open={open}>{open && <Details id={p.id} />}</Collapse>
    </li>
  );
}

function Available({ a, installed, busy, run }) {
  const meta = [a.marketplaceName, a.installCount ? t('{n} installs', { n: a.installCount.toLocaleString() }) : ''].filter(Boolean).join(' · ');
  return (
    <li class="skill plugin">
      <div class="plugin-row">
        <div class="skill-text">
          <div class="skill-name"><span>{a.name}</span><span class="skill-tokens">{meta}</span></div>
          {a.description && <div class="skill-desc" title={a.description}>{a.description}</div>}
        </div>
        <div class="skill-actions">
          {installed
            ? <span class="plugin-installed"><Icon name="check" size={13} />{t('Installed')}</span>
            : <button type="button" class="secondary-btn" disabled={Boolean(busy)} onClick={() => run('install', a.pluginId)}>
                {busy === a.pluginId ? t('Installing…') : t('Install')}
              </button>}
        </div>
      </div>
    </li>
  );
}

const DONE = {
  install: phrase('{name} is installed.'),
  uninstall: phrase('{name} is uninstalled.'),
  enable: phrase('{name} is on.'),
  disable: phrase('{name} is off.'),
  update: phrase('{name} is up to date.'),
  'marketplace-add': phrase('Marketplace added.'),
  'marketplace-update': phrase('Marketplaces refreshed.'),
};

function PluginsPanel() {
  const [data, setData] = useState(null); // { installed, available, marketplaces } | { error }
  const [tab, setTab] = useState('installed');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(''); // the plugin (or action) being worked on
  const [source, setSource] = useState('');

  const load = async () => {
    const res = await api.plugins.list(cwd());
    setData(res.ok ? res : { error: res.error });
    return res;
  };
  useEffect(() => { load().then((res) => { if (res.ok && !res.installed.length) setTab('discover'); }); }, []);

  const run = async (action, id = '') => {
    if (action === 'uninstall' && !(await confirmDialog({
      title: t('Uninstall {name}?', { name: nameOf(id) }),
      message: t('What it adds (skills, commands, agents, servers) goes from your sessions.'),
      confirm: t('Uninstall'), danger: true,
    }))) return;
    setBusy(id || action);
    const request = { action, id, cwd: cwd(), source };
    let res = await api.plugins.run(request);
    // A plugin its marketplace installs by running a command: the command is shown, and run only if you agree.
    const shown = res.result?.shownCommand;
    if (!res.ok && action === 'install' && shown?.sha256) {
      const yes = await confirmDialog({
        title: t('Run a command to install {name}?', { name: nameOf(id) }),
        detail: shown.command || shown.text || JSON.stringify(shown),
        message: t('Its marketplace installs it by running this on your computer. Agree only if you trust the marketplace.'),
        confirm: t('Run and install'), danger: true,
      });
      res = yes ? await api.plugins.run({ ...request, accept: shown.sha256 }) : { ok: false, error: '' };
    }
    setBusy('');
    if (!res.ok) {
      if (res.error) toast(res.error, 'error');
      return;
    }
    if (action === 'marketplace-add') setSource('');
    reloadChats();
    toast(t(DONE[action], { name: nameOf(id) }));
    await load();
  };

  if (!data) return <p class="skills-note">{t('Asking Claude Code for its plugins…')}</p>;
  if (data.error) return <p class="skills-note bad">{data.error}</p>;
  const q = filter.trim().toLowerCase();
  const matches = (...texts) => !q || texts.some((x) => (x || '').toLowerCase().includes(q));
  const installedIds = new Set(data.installed.map((p) => p.id)); // Claude Code leaves them out of the available list
  const installed = data.installed.filter((p) => matches(p.id, p.description)).sort((a, b) => a.id.localeCompare(b.id));
  const available = data.available.filter((a) => matches(a.name, a.description, a.marketplaceName))
    .sort((a, b) => (b.installCount || 0) - (a.installCount || 0) || a.name.localeCompare(b.name));

  return (
    <div class="skills plugins">
      <div class="skills-bar">
        <Segmented name="plugins-tab" value={tab} onChange={setTab} options={[
          { value: 'installed', label: t('Installed ({n})', { n: data.installed.length }) },
          { value: 'discover', label: t('Discover') },
        ]} />
        <div class="skills-search">
          <Icon name="search" size={14} />
          <input type="text" value={filter} spellcheck={false} onInput={(e) => setFilter(e.currentTarget.value)}
                 placeholder={tab === 'installed' ? t('Search installed plugins') : t('Search {n} plugins', { n: data.available.length })} />
        </div>
      </div>
      <div class="skills-list">
        {tab === 'installed' ? (
          installed.length ? <ul>{installed.map((p) => <Installed key={p.id} p={p} busy={Boolean(busy)} run={run} />)}</ul>
            : <p class="skills-note">{data.installed.length ? t('No plugins match.') : t('No plugins installed yet: find some under Discover.')}</p>
        ) : (
          available.length ? <ul>{available.map((a) => <Available key={a.pluginId} a={a} installed={installedIds.has(a.pluginId)} busy={busy} run={run} />)}</ul>
            : <p class="skills-note">{data.available.length ? t('No plugins match.') : t('No marketplace offers plugins yet. Add one below, for example anthropics/claude-plugins-official.')}</p>
        )}
      </div>
      <div class="skills-foot">
        {tab === 'installed' ? (
          <span>{t('Open chats pick up a change at once; CLI sessions when started again.')}</span>
        ) : (
          <>
            <span class="plugin-markets" title={data.marketplaces.map((m) => m.repo || m.path || m.source).join('\n')}>
              {data.marketplaces.length ? t('Marketplaces: {names}', { names: data.marketplaces.map((m) => m.name).join(', ') }) : t('No marketplaces')}
            </span>
            <span class="spacer" />
            <form class="plugin-add" onSubmit={(e) => { e.preventDefault(); if (source.trim()) run('marketplace-add'); }}>
              <input type="text" value={source} spellcheck={false} placeholder={t('owner/repo, URL or folder')} aria-label={t('Marketplace to add')}
                     onInput={(e) => setSource(e.currentTarget.value)} />
              <button type="submit" class="secondary-btn" disabled={Boolean(busy) || !source.trim()}>{busy === 'marketplace-add' ? t('Adding…') : t('Add')}</button>
            </form>
            <button type="button" class="secondary-btn" disabled={Boolean(busy)} title={t('Fetch what the marketplaces offer now')} onClick={() => run('marketplace-update')}>
              <Icon name="refresh" size={14} />{t('Refresh')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function PluginsDialog() {
  return (
    <Dialog open={pluginsDialog.value} wide title={t('Plugins')} className="dialog-skills dialog-plugins" onClose={() => { pluginsDialog.value = false; }}>
      {pluginsDialog.value && <PluginsPanel />}
    </Dialog>
  );
}
