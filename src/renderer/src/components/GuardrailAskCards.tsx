import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';

/** #716: "ask" backstop cards. One-shot — approving releases exactly one call. */
interface Pending {
  fingerprint: string; agentId: string; rule: string; command: string; askedAt: number; expiresAt: number;
}

export function GuardrailAskCards() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending[]>([]);
  const refresh = useCallback(async () => {
    try { setPending(await window.cth.guardrailApprovals()); } catch { /* keep last good */ }
  }, []);
  useEffect(() => {
    refresh();
    const off = window.cth.onGuardrailAsk?.((p) => setPending(Array.isArray(p) ? p as Pending[] : []));
    return () => { off?.(); };
  }, [refresh]);

  const decide = async (fp: string, approve: boolean) => {
    try { approve ? await window.cth.guardrailApprove(fp) : await window.cth.guardrailDeny(fp); } catch { /* ignore */ }
    await refresh();
  };

  if (!pending.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {pending.map((p) => (
        <div key={p.fingerprint} style={{ padding: 9, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-coral)', fontFamily: 'var(--cth-font-mono)' }}>
          <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-coral)', textTransform: 'uppercase' }}>
            {t('settings.guardrail.askTitle')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cth-ink-900)', marginTop: 4 }}>{t('settings.guardrail.askRule', { rule: p.rule })}</div>
          <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', marginTop: 4, overflowWrap: 'anywhere' }}>{p.command}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <PixelButton variant="primary" size="sm" onClick={() => void decide(p.fingerprint, true)}>{t('settings.guardrail.approveOnce')}</PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={() => void decide(p.fingerprint, false)}>{t('settings.guardrail.deny')}</PixelButton>
          </div>
        </div>
      ))}
    </div>
  );
}
