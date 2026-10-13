// Interactive cards for permission requests: allow/deny a tool, answer Claude's questions,
// approve a plan.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui.jsx';
import { Markdown } from './Items.jsx';
import { answerPermission } from '../../lib/sessions.js';

const DESTINATIONS = {
  session: 'this session',
  localSettings: 'this project, just for you',
  projectSettings: 'this project',
  userSettings: 'all your projects',
  cliArg: 'this session',
};
// Inputs that appear after the page loaded need an explicit focus() call; the autofocus attribute is ignored.
function FocusedInput(props) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <input ref={ref} type="text" {...props} />;
}

export const MODE_LABELS = {
  default: 'Ask before acting',
  acceptEdits: 'Accept edits',
  plan: 'Plan first',
  auto: 'Auto',
  dontAsk: 'Don’t ask',
  bypassPermissions: 'Bypass permissions',
};

function describeSuggestion(u) {
  const where = DESTINATIONS[u.destination] || u.destination;
  switch (u.type) {
    case 'addRules':
    case 'replaceRules':
      return `${u.behavior === 'allow' ? 'Allow' : u.behavior === 'deny' ? 'Deny' : 'Ask for'} ${u.rules
        .map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ')} in ${where}`;
    case 'setMode':
      return `Switch to “${MODE_LABELS[u.mode] || u.mode}” for ${where}`;
    case 'addDirectories':
      return `Allow access to ${u.directories.join(', ')} in ${where}`;
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
  const title = request.title || `Allow Claude to use ${request.displayName || request.toolName}?`;

  return (
    <div class="prompt" role="group" aria-label={title}>
      <div class="prompt-title"><Icon name="alert" size={15} />{title}</div>
      {request.description && <p class="prompt-desc">{request.description}</p>}
      {request.decisionReason && <p class="prompt-desc">{request.decisionReason}</p>}
      {request.blockedPath && <p class="prompt-desc">Outside the project folder: <code>{request.blockedPath}</code></p>}
      {!denying ? (
        <div class="prompt-actions">
          <button class="primary-btn" onClick={allow}>Allow</button>
          {suggestions.length > 0 && (
            <button class="secondary-btn" onClick={allowAlways} title={suggestions.map(describeSuggestion).join('\n')}>
              Allow and don’t ask again
            </button>
          )}
          <button class="secondary-btn" onClick={() => setDenying(true)}>Deny…</button>
          {suggestions.length > 0 && <span class="prompt-hint">{describeSuggestion(suggestions[0])}</span>}
        </div>
      ) : (
        <form class="prompt-deny" onSubmit={deny}>
          <FocusedInput value={reason} onInput={(e) => setReason(e.currentTarget.value)}
                        placeholder="Tell Claude what to do instead (optional)" />
          <button type="submit" class="danger-btn">Deny</button>
          <button type="button" class="secondary-btn" onClick={() => setDenying(false)}>Back</button>
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
                      <span class="q-label">Other</span>
                      {chosen.has('__other') && (
                        <FocusedInput value={other[q.question] || ''} placeholder="Type your answer"
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
        <button type="submit" class="primary-btn" disabled={!complete}>Send answer{questions.length > 1 ? 's' : ''}</button>
        <button type="button" class="secondary-btn" onClick={skip}>Skip</button>
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
      <div class="prompt-title"><Icon name="check" size={15} />Claude has a plan and is ready to start</div>
      {plan && <Markdown text={plan} className="plan-text" />}
      {!revising ? (
        <div class="prompt-actions">
          <button class="primary-btn" onClick={() => approve(false)}>Approve plan</button>
          <button class="secondary-btn" onClick={() => approve(true)} title="Approve, then let Claude edit files without asking">
            Approve and accept edits
          </button>
          <button class="secondary-btn" onClick={() => setRevising(true)}>Keep planning…</button>
        </div>
      ) : (
        <form class="prompt-deny" onSubmit={keepPlanning}>
          <FocusedInput value={feedback} onInput={(e) => setFeedback(e.currentTarget.value)}
                 placeholder="What should change in the plan? (optional)" />
          <button type="submit" class="primary-btn">Send back</button>
          <button type="button" class="secondary-btn" onClick={() => setRevising(false)}>Back</button>
        </form>
      )}
    </div>
  );
}
