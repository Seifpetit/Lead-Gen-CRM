// The plain sentence shown while a run works, one per moment worth saying. Templates only: the
// counts and the region and sector names are filled in, and no internal step names are used.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "olive oil", "olive oil and textile", "olive oil, textile and steel"; many become a count. */
export function sectorList(names: readonly string[]): string {
  const lower = names.map((n) => n.toLowerCase());
  if (lower.length === 0) return '';
  if (lower.length === 1) return lower[0]!;
  if (lower.length > 3) return `${lower.length} sectors`;
  return `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
}

export interface SearchFacts {
  region: string;
  /** Sector names the run searches; empty with `customOnly` for typed-in searches only. */
  sectors: readonly string[];
  customOnly: boolean;
}

function what(f: SearchFacts): string {
  if (f.customOnly) return 'your searches';
  const list = sectorList(f.sectors);
  return list === '' ? 'companies' : `${list} companies`;
}

export const liveMessages = {
  searching: (f: SearchFacts) => `Searching Google Maps for ${what(f)} in ${f.region}...`,
  searchingProgress: (f: SearchFacts & { done: number; total: number; found: number }) =>
    `Searching Google Maps for ${what(f)} in ${f.region}... ${f.done} of ${plural(f.total, 'search', 'searches')} done, ${plural(f.found, 'company', 'companies')} found so far.`,
  checking: (f: { found: number }) =>
    f.found === 0
      ? 'No new companies were found, wrapping up...'
      : `Found ${plural(f.found, 'company', 'companies')}, checking which ones move goods...`,
  people: (f: { qualified: number }) =>
    f.qualified === 0
      ? 'None of the companies looked like a fit, wrapping up...'
      : `${plural(f.qualified, 'company looks', 'companies look')} like a fit. Looking up the people who work there...`,
  peopleProgress: (f: { done: number; total: number }) =>
    `Looking up the people who work there... ${f.done} of ${plural(f.total, 'company', 'companies')} done.`,
  contacts: (f: { people: number }) =>
    `Found ${plural(f.people, 'person', 'people')}. Looking for their email addresses and phone numbers...`,
  emails: (f: { count: number }) =>
    `Verifying ${plural(f.count, 'email address', 'email addresses')}...`,
  verifying: (f: { companies: number }) =>
    `Checking the contact details of ${plural(f.companies, 'company', 'companies')}...`,
  scoring: (f: { companies: number }) =>
    `Scoring and ranking ${plural(f.companies, 'company', 'companies')}...`,
  done: (f: { leads: number }) =>
    f.leads === 0
      ? 'Done. No leads this time.'
      : `Done. ${plural(f.leads, 'lead is', 'leads are')} ready.`,
  stopped: (f: { leads: number }) => `Stopped. ${plural(f.leads, 'lead was', 'leads were')} kept.`,
  cappedOut: (f: { leads: number }) =>
    `Stopped before the next step to stay under your spend cap. ${plural(f.leads, 'lead was', 'leads were')} kept.`,
  failed: (f: { reason?: string | null }) =>
    f.reason ? `This run could not finish: ${f.reason}` : 'This run could not finish.',
};
