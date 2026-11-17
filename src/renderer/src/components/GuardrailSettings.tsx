import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';

/**
 * Opt-in guardrail rules (issue #716). A rule is a plain sentence with a
 * backstop: log / ask / block. Off by default and write-safe — nothing is
 * enforced or logged until the operator turns it on.
 */

type Backstop = 'log' | 'ask' | 'block';
interface Rule { id: string; sentence: string; backstop: Backstop; enabled: boolean }
interface Cfg { enabled: boolean; rules: Rule[] }

const EMPTY: Cfg = { enabled: false, rules: [] };

export function GuardrailSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<Cfg>(EMPTY);
  const [sentence, setSentence] = useState('');
  const [backstop, setBackstop] = useState<Backstop>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try { setCfg(await window.cth.guardrailGet() as Cfg); } catch { /* keep last good */ }
  }, []);
  useEffect(() => { refresh(); window.cth.onGuardrailAsk?.(() => {}); }, [refresh]);

  const save = async (next: Cfg) => {
    setBusy(true); setError('');
    try {
      const r = await window.cth.guardrailSave(next);
      if (!r.ok) { setError(r.error ?? t('settings.guardrail.failed')); return; }
      setCfg(next);
    } catch { setError(t('settings.guardrail.failed')); }
    setBusy(false);
  };

  const enable = async () => {
    setBusy(true);
    try { setCfg(await window.cth.guardrailEnable() as Cfg); } catch { /* ignore */ }
    setBusy(false);
  };

  const addRule = () => {
    if (!sentence.trim()) return;
    const next = { ...cfg, rules: [...cfg.rules, { id: `rule-${Date.now()}`, sentence: sentence.trim(), backstop, enabled: true }] };
    setSentence(''); void save(next);
  };
  const update = (id: string, patch: Partial<Rule>) => save({ ...cfg, rules: cfg.rules.map((r) => r.id === id ? { ...r, ...patch } : r) });
  const remove = (id: string) => save({ ...cfg, rules: cfg.rules.filter((r) => r.id !== id) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--cth-font-mono)' }}>
      <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-700)', textTransform: 'uppercase' }}>
        {t('settings.guardrail.title')}
      </div>
      <div style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)' }}>{t('settings.guardrail.help')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PixelButton variant={cfg.enabled ? 'destructive' : 'primary'} size="sm" disabled={busy}
          onClick={() => cfg.enabled ? void save({ ...cfg, enabled: false }) : void enable()}>
          {cfg.enabled ? t('settings.guardrail.turnOff') : t('settings.guardrail.turnOn')}
        </PixelButton>
        <span style={{ fontSize: 11, color: cfg.enabled ? 'var(--cth-sky)' : 'var(--cth-ink-500)' }}>
          {cfg.enabled ? t('settings.guardrail.on') : t('settings.guardrail.off')}
        </span>
      </div>
      {cfg.rules.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
          <input type="checkbox" checked={r.enabled} onChange={(e) => void update(r.id, { enabled: e.target.checked })} />
          <span style={{ flex: 1, fontSize: 12, color: r.enabled ? 'var(--cth-ink-900)' : 'var(--cth-ink-300)' }}>{r.sentence}</span>
          <select value={r.backstop} onChange={(e) => void update(r.id, { backstop: e.target.value as Backstop })}
            style={{ fontSize: 11, background: 'var(--cth-paper-200)', border: 'none', color: 'var(--cth-ink-900)' }}>
            <option value="log">{t('settings.guardrail.log')}</option>
            <option value="ask">{t('settings.guardrail.ask')}</option>
            <option value="block">{t('settings.guardrail.block')}</option>
          </select>
          <button onClick={() => void remove(r.id)} title={t('settings.guardrail.remove')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)' }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder={t('settings.guardrail.rulePlaceholder')}
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontSize: 12, color: 'var(--cth-ink-900)' }} />
        <PixelButton variant="secondary" size="sm" disabled={busy || !sentence.trim()} onClick={addRule}>{t('settings.guardrail.add')}</PixelButton>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--cth-coral)' }}>{error}</div>}
    </div>
  );
}
