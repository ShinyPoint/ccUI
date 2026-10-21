// Interactive cards for permission requests: allow/deny a tool, answer Claude's questions,
// approve a plan.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui.jsx';
import { Markdown } from './Items.jsx';
import { answerPermission } from '../../lib/sessions.js';
import { t, phrase } from '../../lib/i18n.js';

const DESTINATIONS = {
  session: phrase('this session'),
  localSettings: phrase('this project, just for you'),
  projectSettings: phrase('this project'),
  userSettings: phrase('all your projects'),
  cliArg: phrase('this session'),
};
// Inputs that appear after the page loaded need an explicit focus() call; the autofocus attribute is ignored.
function FocusedInput(props) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <input ref={ref} type="text" {...props} />;
}

// English, as phrases: shown with t() (modeLabel).
export const MODE_LABELS = {
  default: phrase('Ask before acting'),
  acceptEdits: phrase('Accept edits'),
  plan: phrase('Plan first'),
  auto: phrase('Auto'),
  dontAsk: phrase('Don’t ask'),
  bypassPermissions: phrase('Bypass permissions'),
};
export const modeLabel = (mode) => (MODE_LABELS[mode] ? t(MODE_LABELS[mode]) : mode);

function describeSuggestion(u) {
  const where = DESTINATIONS[u.destination] ? t(DESTINATIONS[u.destination]) : u.destination;
  switch (u.type) {
    case 'addRules':
    case 'replaceRules': {
      const rules = u.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ');
      if (u.behavior === 'allow') return t('Allow {rules} in {where}', { rules, where });
      if (u.behavior === 'deny') return t('Deny {rules} in {where}', { rules, where });
      return t('Ask for {rules} in {where}', { rules, where });
    }
    case 'setMode':
      return t('Switch to “{mode}” for {where}', { mode: modeLabel(u.mode), where });
    case 'addDirectories':
      return t('Allow access to {folders} in {where}', { folders: u.directories.join(', '), where });
    default:
      return u.type;
  }
}

export function PermissionPrompt({ session, request }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const suggestions = request.suggestions || [];
  const allow = () => answerPermission(session, request, { behavior: 'allow' });
  const allowAlways = () => answerPermission(session, request, { behavior: 'allow', updatedPermissions: suggestions });
  const deny = (e) => {
    e.preventDefault();
    answerPermission(session, request, {
      behavior: 'deny',
      message: reason.trim() ? `The user declined and said: ${reason.trim()}` : 'The user declined this action.',
    });
  };
  const title = request.title || t('Allow Claude to use {tool}?', { tool: request.displayName || request.toolName });

  return (
    <div class="prompt" role="group" aria-label={title}>
      <div class="prompt-title"><Icon name="alert" size={15} />{title}</div>
      {request.description && <p class="prompt-desc">{request.description}</p>}
      {request.decisionReason && <p class="prompt-desc">{request.decisionReason}</p>}
      {request.blockedPath && <p class="prompt-desc">{t('Outside the project folder:')} <code>{request.blockedPath}</code></p>}
      {!denying ? (
        <div class="prompt-actions">
          <button class="primary-btn" onClick={allow}>{t('Allow')}</button>
          {suggestions.length > 0 && (
            <button class="secondary-btn" onClick={allowAlways} title={suggestions.map(describeSuggestion).join('\n')}>
              {t('Allow and don’t ask again')}
            </button>
          )}
          <button class="secondary-btn" onClick={() => setDenying(true)}>{t('Deny…')}</button>
          {suggestions.length > 0 && <span class="prompt-hint">{describeSuggestion(suggestions[0])}</span>}
        </div>
      ) : (
        <form class="prompt-deny" onSubmit={deny}>
          <FocusedInput value={reason} onInput={(e) => setReason(e.currentTarget.value)}
                        placeholder={t('Tell Claude what to do instead (optional)')} />
          <button type="submit" class="danger-btn">{t('Deny')}</button>
          <button type="button" class="secondary-btn" onClick={() => setDenying(false)}>{t('Back')}</button>
        </form>
      )}
    </div>
  );
}

export function QuestionPrompt({ session, request }) {
  const questions = request.input?.questions || [];
  const [picked, setPicked] = useState({}); // question -> Set of labels
  const [other, setOther] = useState({}); // question -> free text

  const toggle = (q, label) => {
    const current = new Set(picked[q.question] || []);
    if (q.multiSelect) {
      if (current.has(label)) current.delete(label);
      else current.add(label);
    } else {
      current.clear();
      current.add(label);
    }
    setPicked({ ...picked, [q.question]: current });
  };

  const answerFor = (q) => {
    const labels = [...(picked[q.question] || [])].map((l) => (l === '__other' ? (other[q.question] || '').trim() : l)).filter(Boolean);
    return labels.join(', ');
  };
  const complete = questions.every((q) => answerFor(q));

  const submit = (e) => {
    e.preventDefault();
    const answers = Object.fromEntries(questions.map((q) => [q.question, answerFor(q)]));
    answerPermission(session, request, { behavior: 'allow', updatedInput: { ...request.input, answers } });
  };
  const skip = () => answerPermission(session, request, { behavior: 'deny', message: 'The user chose not to answer.' });

  return (
    <form class="prompt question" onSubmit={submit}>
      {questions.map((q) => {
        const chosen = picked[q.question] || new Set();
        return (
          <fieldset key={q.question}>
            <legend>{q.header && <span class="q-header">{q.header}</span>}{q.question}</legend>
            <div class="q-options">
              {[...q.options, { label: '__other', description: '' }].map((o) => (
                <label key={o.label} class={`q-option ${chosen.has(o.label) ? 'chosen' : ''}`}>
                  <input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.question} checked={chosen.has(o.label)}
                         onChange={() => toggle(q, o.label)} />
                  {o.label === '__other' ? (
                    <span class="q-text">
                      <span class="q-label">{t('Other')}</span>
                      {chosen.has('__other') && (
                        <FocusedInput value={other[q.question] || ''} placeholder={t('Type your answer')}
                               onInput={(e) => setOther({ ...other, [q.question]: e.currentTarget.value })} />
                      )}
                    </span>
                  ) : (
                    <span class="q-text">
                      <span class="q-label">{o.label}</span>
                      {o.description && <span class="q-desc">{o.description}</span>}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <div class="prompt-actions">
        <button type="submit" class="primary-btn" disabled={!complete}>{questions.length > 1 ? t('Send answers') : t('Send answer')}</button>
        <button type="button" class="secondary-btn" onClick={skip}>{t('Skip')}</button>
      </div>
    </form>
  );
}

export function PlanPrompt({ session, request }) {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const plan = typeof request.input?.plan === 'string' ? request.input.plan : '';
  const approve = (acceptEdits) => answerPermission(session, request, {
    behavior: 'allow',
    ...(acceptEdits ? { updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } : {}),
  });
  const keepPlanning = (e) => {
    e.preventDefault();
    answerPermission(session, request, {
      behavior: 'deny',
      message: feedback.trim() ? `Keep planning. Feedback on the plan: ${feedback.trim()}` : 'Keep planning; the user did not approve this plan yet.',
    });
  };

  return (
    <div class="prompt plan">
      <div class="prompt-title"><Icon name="check" size={15} />{t('Claude has a plan and is ready to start')}</div>
      {plan && <Markdown text={plan} className="plan-text" />}
      {!revising ? (
        <div class="prompt-actions">
          <button class="primary-btn" onClick={() => approve(false)}>{t('Approve plan')}</button>
          <button class="secondary-btn" onClick={() => approve(true)} title={t('Approve, then let Claude edit files without asking')}>
            {t('Approve and accept edits')}
          </button>
          <button class="secondary-btn" onClick={() => setRevising(true)}>{t('Keep planning…')}</button>
        </div>
      ) : (
        <form class="prompt-deny" onSubmit={keepPlanning}>
          <FocusedInput value={feedback} onInput={(e) => setFeedback(e.currentTarget.value)}
                 placeholder={t('What should change in the plan? (optional)')} />
          <button type="submit" class="primary-btn">{t('Send back')}</button>
          <button type="button" class="secondary-btn" onClick={() => setRevising(false)}>{t('Back')}</button>
        </form>
      )}
    </div>
  );
}
