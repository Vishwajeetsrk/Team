/**
 * Opt-in guardrail (issue #716). Pure, electron/fs-free, node-testable.
 *
 * A rule is a plain sentence with a backstop: log, ask, or block. The app is
 * unchanged when there are no rules — evaluateGuardrail([]) always allows with
 * no verdict. When rules exist, a tool call (Bash split into the commands that
 * actually run) is checked against them; the strictest matching backstop wins.
 *
 * Matching is deliberately EXACT-TOKEN, not substring: we extract the operative
 * verb+target from the sentence (push / merge / deploy …) and require those
 * tokens in the normalized command. Fewer false "ask" cards beats catching a
 * paraphrase — a guardrail that cries wolf gets switched off.
 */

export type Backstop = 'log' | 'ask' | 'block';

export interface GuardrailRule {
  id: string;
  sentence: string;
  backstop: Backstop;
  enabled: boolean;
}

export interface GuardrailConfig {
  enabled: boolean;
  rules: GuardrailRule[];
}

export const GUARDRAIL_FILE = 'guardrail.json';
export const GUARDRAIL_BACKUP = 'guardrail.json.bak';
export const MAX_RULES = 200;
export const MAX_SENTENCE = 300;

/** Rules seeded when the operator first turns the guardrail on. */
export const STARTER_RULES: Array<{ sentence: string; backstop: Backstop }> = [
  { sentence: 'Never merge a pull request', backstop: 'block' },
  { sentence: 'Never push to a protected branch', backstop: 'ask' },
  { sentence: 'Push only with my approval', backstop: 'ask' }
];

const BACKSTOPS: Backstop[] = ['log', 'ask', 'block'];
const STRICTNESS: Record<Backstop, number> = { log: 1, ask: 2, block: 3 };

/** Validate one rule; returns an error string or null. Never echoes a value. */
export function validateRule(r: unknown): string | null {
  if (!r || typeof r !== 'object') return 'rule must be an object';
  const x = r as Partial<GuardrailRule>;
  if (typeof x.id !== 'string' || !x.id.trim()) return 'id required';
  if (typeof x.sentence !== 'string' || !x.sentence.trim()) return 'sentence required';
  if (x.sentence.length > MAX_SENTENCE) return `sentence too long (max ${MAX_SENTENCE})`;
  if (typeof x.backstop !== 'string' || !BACKSTOPS.includes(x.backstop)) return 'backstop must be log, ask or block';
  if (typeof x.enabled !== 'boolean') return 'enabled must be boolean';
  return null;
}

/** Parse a saved config defensively; an unusable file reads as OFF with no rules. */
export function parseConfig(raw: unknown): GuardrailConfig {
  const empty: GuardrailConfig = { enabled: false, rules: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as Partial<GuardrailConfig>;
  const rules = Array.isArray(o.rules)
    ? o.rules.slice(0, MAX_RULES).filter((r) => validateRule(r) === null).map((r) => ({
        id: (r as GuardrailRule).id,
        sentence: (r as GuardrailRule).sentence,
        backstop: (r as GuardrailRule).backstop,
        enabled: (r as GuardrailRule).enabled
      }))
    : [];
  return { enabled: o.enabled === true && rules.length > 0, rules };
}

/**
 * Split a Bash command into the individual commands that actually run, so a
 * rule matches a push buried in a pipeline rather than only the first word.
 * Handles && || ; | (outside quotes), and unwraps sh -c / bash -c, xargs, and
 * find … -exec … +/;. Best-effort and safe: malformed input still yields the
 * original command, never throws. Quotes are respected for split points.
 */
export function parseBashCommands(command: string): string[] {
  if (typeof command !== 'string' || !command.trim()) return [];
  const out: string[] = [];
  const push = (s: string): void => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };

  // Split on chain/pipe operators that are outside single/double quotes.
  let cur = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\') { cur += ch; escaped = true; continue; }
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { cur += ch; quote = ch; continue; }
    if (ch === '|' || ch === ';' || ch === '&') {
      // Treat ||, &&, ;; and a lone | or ; the same — each ends a command.
      push(cur); cur = '';
      // Swallow the second char of a doubled operator.
      continue;
    }
    cur += ch;
  }
  push(cur);

  // Unwrap nested commands: sh -c '…', bash -c "…", xargs …, find … -exec ….
  const expanded: string[] = [];
  for (const c of out) {
    expanded.push(c);
    const sh = /(?:^|\s)(?:sh|bash|zsh)\s+-c\s+(['"])([\s\S]*)\1/.exec(c);
    if (sh) expanded.push(...parseBashCommands(sh[2]));
    const xargs = /(?:^|\s)xargs\b(.*)$/.exec(c);
    if (xargs && xargs[1].trim()) expanded.push(xargs[1].trim());
    const exec = /(?:^|\s)-exec\s+(.+?)\s+(?:\+|;)\s*$/.exec(c);
    if (exec) expanded.push(exec[1]);
  }
  return [...new Set(expanded)];
}

/** Operative verbs we can match reliably from a plain sentence. A rule "never
 *  merge a pull request" contributes {merge}; the command must contain that
 *  exact token. Non-operative words (never/a/the/with) are ignored. */
const OP_VERBS = [
  'push', 'merge', 'deploy', 'release', 'publish', 'delete', 'destroy',
  'reset', 'rebase', 'force', 'approve', 'upload', 'install', 'uninstall'
];
/** If a sentence names a concrete branch, require it too (exact token). */
const BRANCH_NAMES = ['main', 'master', 'production', 'prod', 'develop'];

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9_-]+/g) ?? []);
}

/** The operative tokens a rule constrains, extracted from its sentence. */
export function ruleTokens(sentence: string): string[] {
  const t = tokens(sentence);
  const verbs = OP_VERBS.filter((v) => t.has(v));
  const branches = BRANCH_NAMES.filter((b) => t.has(b));
  // Prefer a verb when one exists; otherwise fall back to a named branch.
  return verbs.length ? verbs : branches;
}

/** Exact-token match: every operative token of the rule appears in the command. */
export function matchesRule(rule: GuardrailRule, command: string): boolean {
  const need = ruleTokens(rule.sentence);
  if (!need.length) return false;
  const have = tokens(command);
  return need.every((k) => have.has(k));
}

export interface GuardrailVerdict {
  verdict: 'allow' | Backstop;
  rule?: GuardrailRule;
  reason?: string;
}

/** Evaluate a tool call against all enabled rules. Empty/off ⇒ allow with no
 *  rule (the zero-behavior-change invariant). Strictest backstop wins. */
export function evaluateGuardrail(
  cfg: GuardrailConfig | null | undefined,
  tool: string,
  command: string
): GuardrailVerdict {
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.rules)) return { verdict: 'allow' };
  const cmds = tool.toLowerCase() === 'bash' || tool.toLowerCase() === 'shell'
    ? parseBashCommands(command)
    : [command];
  let best: GuardrailVerdict = { verdict: 'allow' };
  for (const rule of cfg.rules) {
    if (!rule.enabled) continue;
    if (!cmds.some((c) => matchesRule(rule, c))) continue;
    if (rule.backstop === 'block') return { verdict: 'block', rule, reason: `Blocked by guardrail rule: ${rule.sentence}` };
    if (STRICTNESS[rule.backstop] > (best.verdict === 'allow' ? 0 : STRICTNESS[best.verdict])) {
      best = { verdict: rule.backstop, rule, reason: `Guardrail rule: ${rule.sentence}` };
    }
  }
  return best;
}
