// Finds a page's preview image in its HTML (og:image, then twitter:image). Pure: it reads the
// text it is given and never runs scripts or loads anything.

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** In the order they are preferred. */
const IMAGE_KEYS = [
  'og:image',
  'og:image:secure_url',
  'og:image:url',
  'twitter:image',
  'twitter:image:src',
];

const MAX_URL_LENGTH = 2000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** An http or https address, resolved against the page's own address; anything else is null. */
export function absoluteHttpUrl(value: string, base: string): string | null {
  const trimmed = decodeEntities(value.trim());
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The best preview image address in the HTML, or null. `pageUrl` resolves relative addresses. */
export function parsePageImage(html: string, pageUrl: string): string | null {
  const found = new Map<string, string>();
  for (const tag of html.match(META_TAG) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(ATTRIBUTE)) {
      attrs.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').trim().toLowerCase();
    const content = attrs.get('content');
    if (!key || content === undefined || !IMAGE_KEYS.includes(key) || found.has(key)) continue;
    const url = absoluteHttpUrl(content, pageUrl);
    if (url) found.set(key, url);
  }
  for (const key of IMAGE_KEYS) {
    const url = found.get(key);
    if (url) return url;
  }
  return null;
}
