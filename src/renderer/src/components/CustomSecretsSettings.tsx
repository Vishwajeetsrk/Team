import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';

/**
 * Keys and secrets (free-win md-secret). Operator-facing, WRITE-ONLY: the
 * renderer lists names + a hasValue boolean, stores a value one way, and can
 * never read a secret back. Agents read these through the loopback broker.
 */

type SecretRow = { name: string; hasValue: boolean };

export function CustomSecretsSettings() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setRows(await window.cth.secretsList()); } catch { /* keep last good */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    const n = name.trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,64}$/.test(n)) { setError(t('settings.secrets.badName')); return; }
    if (!value) { setError(t('settings.secrets.needValue')); return; }
    setBusy(true); setError('');
    try {
      const r = await window.cth.secretsSet({ name: n, value });
      if (!r.ok) { setError(r.error ?? t('settings.secrets.failed')); return; }
      setName(''); setValue(''); await refresh();
    } catch { setError(t('settings.secrets.failed')); }
    setBusy(false);
  };

  const remove = async (n: string) => {
    setBusy(true);
    try { await window.cth.secretsDelete(n); await refresh(); } catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--cth-font-mono)' }}>
      <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-700)', textTransform: 'uppercase' }}>
        {t('settings.secrets.title')}
      </div>
      <div style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)' }}>
        {t('settings.secrets.help')}
      </div>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--cth-ink-900)' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span style={{ fontSize: 10, color: r.hasValue ? 'var(--cth-sky)' : 'var(--cth-ink-300)' }}>
                {r.hasValue ? t('settings.secrets.stored') : t('settings.secrets.empty')}
              </span>
              <button onClick={() => void remove(r.name)} disabled={busy} title={t('settings.secrets.remove')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)' }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.secrets.namePlaceholder')}
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontSize: 12, color: 'var(--cth-ink-900)' }} />
        <input value={value} onChange={(e) => setValue(e.target.value)} type="password" placeholder={t('settings.secrets.valuePlaceholder')}
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--cth-paper-100)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontSize: 12, color: 'var(--cth-ink-900)' }} />
        <PixelButton variant="primary" size="sm" disabled={busy} onClick={() => void save()}>{t('settings.secrets.save')}</PixelButton>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--cth-coral)' }}>{error}</div>}
    </div>
  );
}
