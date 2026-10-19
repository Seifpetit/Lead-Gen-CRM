import type { RunSummary } from '@lead-gen-crm/shared';
import type { Translate } from '../../i18n/index.js';
import { formatNumber } from '../../lib/format.js';

/** Every place the searches returned: new ones, ones an earlier run knew, ones outside the region. */
export function placesFound(run: Pick<RunSummary, 'funnel' | 'placesDroppedOutside'>): number {
  return run.funnel.discovered + run.funnel.skipped + run.placesDroppedOutside;
}

/**
 * What a run came to, in words: "30 found, 28 leads", "98 places, 0 kept" when places came back
 * but none became a lead, or "No places found". Never "0 found" for a run that found places.
 */
export function runResultText(
  t: Translate,
  run: Pick<RunSummary, 'funnel' | 'placesDroppedOutside'>,
): string {
  const places = placesFound(run);
  const leads = run.funnel.leads;
  if (places === 0) return t('runs.result.none');
  if (leads === 0) return t('runs.result.kept.none', { places: formatNumber(places) });
  return t(leads === 1 ? 'runs.result.leads.one' : 'runs.result.leads', {
    places: formatNumber(places),
    leads: formatNumber(leads),
  });
}
