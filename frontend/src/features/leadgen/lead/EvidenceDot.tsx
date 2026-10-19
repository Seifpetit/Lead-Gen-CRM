import type { EvidenceKind } from '@lead-gen-crm/shared';
import { Tip } from '../../../components/shared/Tip.js';
import { useT } from '../../../i18n/index.js';

/** Fact or Estimate as a small colored dot; the explanation is its tooltip. */
export function EvidenceDot({ kind }: { kind: EvidenceKind | null }) {
  const t = useT();
  const key = kind ?? 'none';
  const name = t(
    key === 'fact' ? 'tag.fact' : key === 'estimate' ? 'tag.estimate' : 'tag.noSource',
  );
  const text = t(`leadView.dot.${key}`);
  return (
    <Tip label={name} text={text}>
      <span className={`dot dot-${key}`} />
    </Tip>
  );
}
