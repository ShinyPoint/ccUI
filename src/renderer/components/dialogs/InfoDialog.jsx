// What some slash commands show in a chat in place of Claude Code's CLI screens (/status, /memory, /mcp; see
// lib/commands.js): sections of rows, each a name with a value or a note, and maybe a button.
import { Dialog, SetGroup, SetRow } from '../ui.jsx';
import { infoDialog } from '../../lib/store.js';
import { t } from '../../lib/i18n.js';

export function InfoDialog() {
  const info = infoDialog.value;
  const close = () => { infoDialog.value = null; };
  return (
    <Dialog open={Boolean(info)} title={info?.title} className="dialog-info" onClose={close}>
      {info && (
        <>
          {info.note && <p class="info-note">{info.note}</p>}
          <div class="info-body">
            {info.sections.map((sec, i) => (
              <SetGroup key={i} title={sec.title}>
                {sec.rows.map((r, j) => (
                  <SetRow key={j} label={r.label} note={r.note}>
                    {r.value !== undefined && r.value !== '' && <span class={`info-value ${r.mono ? 'mono' : ''}`} title={r.value}>{r.value}</span>}
                    {r.action && <button type="button" class="secondary-btn" onClick={r.action.run}>{r.action.label}</button>}
                  </SetRow>
                ))}
              </SetGroup>
            ))}
          </div>
          <div class="dialog-actions">
            <button type="button" class="primary-btn" autofocus onClick={close}>{t('Done')}</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
