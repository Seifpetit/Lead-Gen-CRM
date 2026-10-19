import {
  regionLabel,
  runOutcome,
  type RunOutcome,
  type RunOutcomeInput,
  type RunOutcomeKind,
  type RunSummary,
} from '@lead-gen-crm/shared';
import {
  CircleCheck,
  CircleStop,
  CircleX,
  Coins,
  LoaderCircle,
  SearchSlash,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { StringKey, Translate } from '../../i18n/index.js';
import { useT } from '../../i18n/index.js';
import { formatNumber } from '../../lib/format.js';

const ICONS: Record<RunOutcomeKind, LucideIcon> = {
  running: LoaderCircle,
  completed: CircleCheck,
  no_results: SearchX,
  nothing_found: SearchSlash,
  ended_early: TriangleAlert,
  stopped_by_cap: Coins,
  stopped: CircleStop,
  failed: CircleX,
};

/** What a run came to, as a badge: icon and words, coloured by the verdict (green only for leads). */
export function OutcomeBadge({ run }: { run: RunOutcomeInput }) {
  const t = useT();
  const outcome = runOutcome(run);
  const Icon = ICONS[outcome.kind];
  return (
    <span className="badge badge-outcome" data-tone={outcome.tone} data-outcome={outcome.kind}>
      <Icon size={12} aria-hidden="true" />
      {t(`outcome.${outcome.kind}` as StringKey)}
    </span>
  );
}

const places = (t: Translate, n: number) =>
  t(n === 1 ? 'outcome.place.one' : 'outcome.place', { n: formatNumber(n) });

/**
 * One plain sentence about what a run came to, built from its outcome: "30 places found, 28 leads",
 * "98 places found, none inside Bizerte", "7 kept, 0 people found, so the people step had nothing
 * to carry forward". `searches`, when known, starts the sentence ("16 searches, ...").
 */
export function outcomeText(
  t: Translate,
  run: Pick<RunSummary, 'status' | 'funnel' | 'placesDroppedOutside' | 'region' | 'error'>,
  searches?: number,
): string {
  const o: RunOutcome = runOutcome(run);
  const { counts } = o;
  const found = places(t, counts.places);
  const leads = t(counts.leads === 1 ? 'outcome.lead.one' : 'outcome.lead', {
    n: formatNumber(counts.leads),
  });
  let text: string;
  switch (o.kind) {
    case 'running':
      text =
        counts.places === 0
          ? t('outcome.text.running.none')
          : t('outcome.text.running', { places: found });
      break;
    case 'completed':
      text = t('outcome.text.completed', { places: found, leads });
      break;
    case 'nothing_found':
      text = t('outcome.text.nothing_found');
      break;
    case 'no_results':
      text =
        o.detail === 'outside'
          ? t('outcome.text.outside', { places: found, region: regionLabel(run.region) })
          : t('outcome.text.none_kept', { places: found });
      break;
    case 'ended_early':
      text =
        o.detail === 'no_people'
          ? t('outcome.text.no_people', { kept: formatNumber(counts.kept) })
          : t('outcome.text.no_leads', {
              kept: formatNumber(counts.kept),
              people: formatNumber(counts.people),
            });
      break;
    case 'stopped_by_cap':
      text = t('outcome.text.stopped_by_cap', { places: found, leads });
      break;
    case 'stopped':
      text = t('outcome.text.stopped', { places: found, leads });
      break;
    case 'failed':
      text = run.error
        ? t('outcome.text.failed', { message: run.error })
        : t('outcome.text.failed.plain');
      break;
  }
  return searches !== undefined && searches > 0
    ? t('outcome.text.searches', {
        searches: t(searches === 1 ? 'outcome.search.one' : 'outcome.search', { n: searches }),
        rest: text,
      })
    : text;
}
