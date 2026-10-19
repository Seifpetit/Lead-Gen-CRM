// Cost entries returned by every paid call. The runner writes them to cost_ledger; nothing
// here touches the database.

export type CostProvider = 'apify' | 'google' | 'llm' | 'anthropic' | 'web';

export interface CostEntry {
  provider: CostProvider;
  /** What was bought: an Actor event ("compass/crawler-google-places#place-scraped") or SKU. */
  item: string;
  units: number;
  unitPriceUsd: number;
  /** units x unitPriceUsd, rounded to 6 decimals like the ledger's CHECK. */
  amountUsd: number;
  /** Adapters only ever estimate; actuals come from reconciling against the provider's bill. */
  kind: 'estimated';
}

export function costEntry(
  provider: CostProvider,
  item: string,
  units: number,
  unitPriceUsd: number,
): CostEntry {
  if (!Number.isFinite(units) || units < 0) throw new Error(`Invalid units for ${item}`);
  if (!Number.isFinite(unitPriceUsd) || unitPriceUsd < 0)
    throw new Error(`Invalid unit price for ${item}`);
  return {
    provider,
    item,
    units,
    unitPriceUsd,
    amountUsd: Math.round(units * unitPriceUsd * 1e6) / 1e6,
    kind: 'estimated',
  };
}

export function totalUsd(entries: readonly CostEntry[]): number {
  return Math.round(entries.reduce((sum, e) => sum + e.amountUsd, 0) * 1e6) / 1e6;
}
