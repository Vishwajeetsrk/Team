/**
 * GuardrailStore (issue #716) — one JSON file beside the hive, with a backup
 * on every save. Electron-free? No (uses fs) but no electron import: unit-testable
 * with a temp dir. Durability mirrors roster.ts: backup first, atomic rename.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GUARDRAIL_BACKUP, GUARDRAIL_FILE, STARTER_RULES, parseConfig,
  type GuardrailConfig, type GuardrailRule
} from '../shared/guardrail';

export function guardrailPath(home: string): string { return join(home, GUARDRAIL_FILE); }
export function guardrailBackupPath(home: string): string { return join(home, GUARDRAIL_BACKUP); }

/** Read defensively; a missing/corrupt file is OFF with no rules. */
export function loadGuardrail(home: string): GuardrailConfig {
  try {
    if (!existsSync(guardrailPath(home))) return { enabled: false, rules: [] };
    return parseConfig(JSON.parse(readFileSync(guardrailPath(home), 'utf8')));
  } catch {
    return { enabled: false, rules: [] };
  }
}

/** Save with a backup of the previous file and an atomic rename into place. */
export function saveGuardrail(home: string, cfg: GuardrailConfig): { ok: boolean; error?: string } {
  try {
    const clean = parseConfig(cfg);
    const file = guardrailPath(home);
    if (existsSync(file)) {
      try { copyFileSync(file, guardrailBackupPath(home)); } catch { /* backup best-effort */ }
    }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
    renameSync(tmp, file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Seed the three starter rules and turn the guardrail on (idempotent-ish: only
 *  when currently off with no rules). */
export function enableGuardrail(home: string): GuardrailConfig {
  const cur = loadGuardrail(home);
  if (cur.enabled || cur.rules.length) return cur;
  const seeded: GuardrailConfig = {
    enabled: true,
    rules: STARTER_RULES.map((s, i): GuardrailRule => ({
      id: `starter-${i + 1}`, sentence: s.sentence, backstop: s.backstop, enabled: true
    }))
  };
  saveGuardrail(home, seeded);
  return seeded;
}
