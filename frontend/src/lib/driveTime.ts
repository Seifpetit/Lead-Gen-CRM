// "How long by car from my address?" with no key and no account: the address is found with
// OpenStreetMap's Nominatim and the road route with the public OSRM server, both called straight
// from the browser when the person asks. The address itself is only kept in this browser.

export interface Point {
  lat: number;
  lng: number;
}
export interface MyAddress extends Point {
  text: string;
}
export interface Drive {
  km: number;
  minutes: number;
}

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
export const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const STORAGE_KEY = 'leadgen.myAddress';

export function loadMyAddress(): MyAddress | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MyAddress | null;
    return raw &&
      typeof raw.text === 'string' &&
      Number.isFinite(raw.lat) &&
      Number.isFinite(raw.lng)
      ? raw
      : null;
  } catch {
    return null;
  }
}

export function saveMyAddress(address: MyAddress | null): void {
  try {
    if (address) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(address));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered; the answer on screen still works.
  }
}

/** The first place Nominatim finds for the text, looked for in Tunisia; null when none. */
export async function geocodeAddress(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Point | null> {
  const url = `${NOMINATIM}?${new URLSearchParams({ q: text, format: 'jsonv2', limit: '1', countrycodes: 'tn' })}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
  const found = (await res.json()) as { lat?: string; lon?: string }[];
  const first = found[0];
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);
  return first && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Road distance and time between two points; null when no road route exists. */
export async function driveBetween(
  from: Point,
  to: Point,
  fetchImpl: typeof fetch = fetch,
): Promise<Drive | null> {
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`router answered ${res.status}`);
  const body = (await res.json()) as { routes?: { distance: number; duration: number }[] };
  const route = body.routes?.[0];
  return route ? { km: route.distance / 1000, minutes: route.duration / 60 } : null;
}

/** "45 min", "2 h", "2 h 10 min": whole minutes, rounded to the nearest 5 once over an hour. */
export function formatDriveTime(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const rounded = Math.round(m / 5) * 5;
  const h = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Google Maps directions by car, as a plain link, for when the in-app answer is not available. */
export function googleDirectionsLink(fromText: string, to: Point): string {
  const params = new URLSearchParams({
    api: '1',
    origin: fromText,
    destination: `${to.lat},${to.lng}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
