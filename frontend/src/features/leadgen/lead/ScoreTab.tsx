import type { Lead } from '@lead-gen-crm/shared';
import { Info } from 'lucide-react';
import { Tip } from '../../../components/shared/Tip.js';
import { useT } from '../../../i18n/index.js';
import { EvidenceDot } from './EvidenceDot.js';

const MAX = { companyFit: 50, contactFit: 30, reachability: 20 } as const;

/** The total large, the three parts as bars side by side, and why as chips. */
export function ScoreTab({ lead }: { lead: Lead }) {
  const t = useT();
  const reasons = lead.scoreReasons ?? [];
  return (
    <div className="lead-score">
      <p className="score-hero">
        <span className="score-big">{lead.score.total}</span>
        <span className="muted">{t('leadView.score.of')}</span>
        <Tip label={t('leadView.score.estimate')} text={t('lead.score.estimate')}>
          <Info size={16} aria-hidden="true" />
        </Tip>
      </p>
      <ul className="score-bars" aria-label={t('leadView.score.bars')}>
        {(['companyFit', 'contactFit', 'reachability'] as const).map((part) => (
          <li key={part}>
            <span className="score-bar-label">{t(`lead.score.${part}`)}</span>
            <div
              className="meter"
              role="meter"
              aria-label={t(`lead.score.${part}`)}
              aria-valuemin={0}
              aria-valuemax={MAX[part]}
              aria-valuenow={lead.score[part]}
              aria-valuetext={t('lead.score.outOf', { value: lead.score[part], max: MAX[part] })}
            >
              <span style={{ width: `${(lead.score[part] / MAX[part]) * 100}%` }} />
            </div>
            <span className="score-bar-value">
              {t('lead.score.outOf', { value: lead.score[part], max: MAX[part] })}
            </span>
          </li>
        ))}
      </ul>
      <h3>{t('lead.score.reasons')}</h3>
      {reasons.length > 0 ? (
        <ul className="chips">
          {reasons.map((r, i) => (
            <li key={i} className="chip">
              <span>
                {t('leadView.score.chip', {
                  points: r.points > 0 ? `+${r.points}` : String(r.points),
                  reason: r.reason,
                })}
              </span>
              <EvidenceDot kind={r.kind} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('lead.score.reasons.none')}</p>
      )}
    </div>
  );
}
