// Skills (/skills in a chat): every skill the session knows of, grouped by where it comes from, each with
// Claude Code's four states. A change is written to the chosen settings file (this project, like Claude
// Code's own /skills, or every project) and the session reloads its skills right away.
import { useEffect, useState } from 'preact/hooks';
import { Dialog, Dropdown, Segmented, Icon } from '../ui.jsx';
import { api, skillsDialog, toast } from '../../lib/store.js';
import { formatTokens } from '../../lib/format.js';
import { t, phrase } from '../../lib/i18n.js';

// Labels in English; t() where shown.
const STATES = [
  { value: 'on', label: phrase('On'), hint: phrase('Claude sees it and can use it; you can run it with /name') },
  { value: 'name-only', label: phrase('Name only'), hint: phrase('Listed to Claude without its description, to save context') },
  { value: 'user-invocable-only', label: phrase('Only with /name'), hint: phrase('Hidden from Claude; it runs only when you type /name') },
  { value: 'off', label: phrase('Off'), hint: phrase('Hidden from Claude and from /name') },
];
const GROUPS = [
  { source: 'projectSettings', title: phrase('This project') },
  { source: 'userSettings', title: phrase('Yours') },
  { source: 'plugin', title: phrase('From plugins') },
  { source: 'built-in', title: phrase('Built into Claude Code') },
];
let lastScope = 'project';

// Waits for the session's Claude Code process (a restored chat starts it on first use).
async function agentOf(s) {
  if (s.starting) await s.starting;
  return s.agentId;
}

function SkillRow({ skill, busy, onSet }) {
  const off = skill.state === 'off';
  const scopes = [skill.project && t('this project: {state}', { state: skill.project }), skill.user && t('all projects: {state}', { state: skill.user })].filter(Boolean);
  return (
    <li class={`skill ${off ? 'off' : ''}`}>
      <div class="skill-text">
        <div class="skill-name">
          <span>/{skill.name}</span>
          {skill.tokens > 0 && <span class="skill-tokens" title={t('Context its listing takes')}>{t('{n} tokens', { n: formatTokens(skill.tokens) })}</span>}
        </div>
        {skill.description && <div class="skill-desc" title={skill.description}>{skill.description}</div>}
        {scopes.length > 0 && <div class="skill-set">{t('Set for {scopes}', { scopes: scopes.join(' · ') })}</div>}
      </div>
      <div class="skill-actions">
        {skill.dir && (
          <button type="button" class="icon-btn" title={t('Open its folder')} onClick={() => api.openPath(skill.dir)}>
            <Icon name="folder" size={14} />
          </button>
        )}
        <Dropdown className="skill-state" label={`/${skill.name}`} value={skill.state} disabled={busy} onChange={(v) => onSet(skill, v)}
                  options={STATES.map((x) => ({ value: x.value, label: t(x.label), hint: t(x.hint) }))} />
      </div>
    </li>
  );
}

function SkillsPanel({ s }) {
  const [data, setData] = useState(null); // { skills, folders } | { error }
  const [scope, setScope] = useState(lastScope);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('');

  const run = async (action, arg) => {
    const id = await agentOf(s);
    if (!id) return { ok: false, error: t('This chat isn’t running. Send a message or press Try again first.') };
    return api.agent.control(id, action, arg);
  };
  const load = async (action = 'skills', arg) => {
    const res = await run(action, arg);
    if (res.ok) setData(res.value);
    else if (!data) setData({ error: res.error });
    else toast(res.error, 'error');
    return res;
  };
  useEffect(() => { load(); }, []);

  const set = async (skill, state) => {
    setBusy(skill.name);
    await load('set-skill', { name: skill.name, state, scope });
    setBusy('');
  };
  const reload = async () => {
    setBusy('*');
    const res = await load('reload-skills');
    setBusy('');
    if (res.ok) toast(t('Skills reloaded from disk.'));
  };
  const openFolder = async (where) => {
    const res = await run('skills-folder', where);
    if (res.ok) api.openPath(res.value);
    else toast(res.error, 'error');
  };

  if (!data) return <p class="skills-note">{t('Loading skills…')}</p>;
  if (data.error) return <p class="skills-note bad">{data.error}</p>;
  const q = filter.trim().toLowerCase();
  const shown = data.skills
    .filter((x) => !q || x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = [...GROUPS, { source: '', title: phrase('Other') }]
    .map((g) => ({ ...g, items: shown.filter((x) => (g.source ? x.source === g.source : !GROUPS.some((k) => k.source === x.source))) }))
    .filter((g) => g.items.length);
  const counts = { on: data.skills.filter((x) => x.state !== 'off').length, all: data.skills.length };

  return (
    <div class="skills">
      <div class="skills-bar">
        <div class="skills-search">
          <Icon name="search" size={14} />
          <input type="text" value={filter} placeholder={t('Search {n} skills', { n: counts.all })} spellcheck={false}
                 onInput={(e) => setFilter(e.currentTarget.value)} />
        </div>
        <span class="skills-scope-label">{t('Changes apply to')}</span>
        <Segmented name="skills-scope" value={scope} onChange={(v) => { lastScope = v; setScope(v); }} options={[
          { value: 'project', label: t('This project'), title: t('.claude/settings.local.json in {folder}, like Claude Code’s /skills', { folder: s.cwd }) },
          { value: 'user', label: t('All projects'), title: t('Your Claude Code settings (settings.json)') },
        ]} />
      </div>
      <div class="skills-list">
        {groups.map((g) => (
          <section key={g.title}>
            <h4>{t(g.title)}</h4>
            <ul>{g.items.map((x) => <SkillRow key={x.name} skill={x} busy={Boolean(busy)} onSet={set} />)}</ul>
          </section>
        ))}
        {!groups.length && <p class="skills-note">{t('No skills match.')}</p>}
      </div>
      <div class="skills-foot">
        <span>{t('{on} of {all} in use. A project’s own setting wins over All projects.', { on: counts.on, all: counts.all })}</span>
        <span class="spacer" />
        <button type="button" class="secondary-btn" onClick={() => openFolder('project')}>{t('Project skills folder')}</button>
        <button type="button" class="secondary-btn" onClick={() => openFolder('user')}>{t('Your skills folder')}</button>
        <button type="button" class="secondary-btn" disabled={Boolean(busy)} onClick={reload}>
          <Icon name="refresh" size={14} />{t('Reload')}
        </button>
      </div>
    </div>
  );
}

export function SkillsDialog() {
  const s = skillsDialog.value;
  return (
    <Dialog open={Boolean(s)} wide title={t('Skills')} className="dialog-skills" onClose={() => { skillsDialog.value = null; }}>
      {s && <SkillsPanel key={s.uid} s={s} />}
    </Dialog>
  );
}
