// Why a message to the Overseer did not change the game, named from what really happened (J, 2026-11-06: "I couldn't
// finish that" every time, with no way to tell why). Pure: gameai.ts uses it, test/gameai-errors.test.ts proves it.

export type FailKind = 'auth' | 'busy' | 'timeout' | 'empty' | 'rejected' | 'garbled' | 'cancelled' | 'stalled' | 'unreachable' | 'unknown';

/** The raw error kept on the aiRuns doc and in the log: where, what Gen said (trimmed), never a key. */
export type RawError = { step: string; status: number | null; message: string; kind: FailKind };

const scrub = (s: string) => s.replace(/(sk-ant-[\w-]+|hg_[\w]+|hgo_[\w]+|Bearer\s+[\w.-]+)/g, '[key]').replace(/\s+/g, ' ').trim().slice(0, 400);

/** What kind of failure this is. `status` is Gen's HTTP status when there was one; `message` is Gen's own words. */
export function classify(status: number | null | undefined, message: unknown): FailKind {
  const m = String(message ?? '').toLowerCase();
  const st = Number(status) || 0;
  if (m === 'empty') return 'empty';
  if (m === 'stalled') return 'stalled';
  if (m === 'timeout') return 'timeout';
  if (m === 'unreachable') return 'unreachable';
  if (m === 'rejected') return 'rejected';
  if (st === 401 || st === 402 || st === 403 || /needs your own access|own anthropic|api key|not set up|isn't available|is not in .*\.env|was rejected|unauthori[sz]ed|forbidden|not allowed/.test(m)) return 'auth';
  if (st === 429 || /overload|rate limit|rate-limit|busy|capacity|529/.test(m)) return 'busy';
  if (st === 408 || st === 504 || /timeout|timed out|abort|not answering/.test(m)) return 'timeout';
  if (/json|schema|parse|garbled/.test(m)) return 'garbled';
  return 'unknown';
}

export const rawError = (step: string, status: unknown, message: unknown): RawError => ({ step, status: Number(status) || null, message: scrub(String(message ?? '')), kind: classify(Number(status) || null, message) });

/** The plain sentence for the chat. `nothing`: the game did not change (else what was built stays). */
export function plainReason(kind: FailKind, nothing = true) {
  const after = nothing ? ' Nothing in your game changed, and the credits are back in your account.' : ' What I had already built stays, and the credits are back in your account.';
  switch (kind) {
    case 'auth': return `I can't reach my AI service right now. That's on our side, not yours.${after} Try again in a little while.`;
    case 'busy': return `The AI is very busy right now.${after} Try again in a minute.`;
    case 'timeout': return `That was taking too long, so I stopped it.${after} Try again, or ask for a smaller piece first.`;
    case 'empty': return `I came back with nothing I could use.${after} Try again; rewording can help.`;
    case 'garbled': return `My answer came back garbled, so I didn't use it.${after} Try again; rewording can help.`;
    case 'rejected': return `I understood you, but the game wouldn't take my change.${after} Try again, or say it a different way.`;
    case 'stalled': return `I lost my place while working on that, so I stopped it.${after} Try again.`;
    case 'unreachable': return `I lost my connection to the AI service.${after} Give it a moment and try again.`;
    case 'cancelled': return `That request was cancelled before I finished.${after}`;
    default: return `I couldn't finish that.${after} Try again, or say it a different way.`;
  }
}

/** A finished answer that changed nothing because every change was refused is a failure ("game update rejected"), not "Done." */
export const wasRejected = (lines: { ops: number; applied: number; files: number; filesDone: number }) => lines.ops + lines.files > 0 && lines.applied + lines.filesDone === 0;
