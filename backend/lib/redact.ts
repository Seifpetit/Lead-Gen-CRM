// Run logs are shown to people and downloaded as text, so nothing that works as a credential may
// reach them. Known secrets are blanked by value; anything shaped like a token, key or password
// is blanked by pattern, in case an error message quotes a URL or header.

const MASK = '[hidden]';

/** Anything that looks like a credential, whatever its value. */
const PATTERNS: readonly [RegExp, string][] = [
  [/\bapify_api_[A-Za-z0-9]{6,}/g, `apify_api_${MASK}`],
  [/\bsk-ant-[A-Za-z0-9_-]{6,}/g, `sk-ant-${MASK}`],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, `sk-${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, MASK],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${MASK}`],
  // key=value or "key": "value" for names that carry credentials.
  [
    /\b((?:x-)?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization|signature|cookie|session)["']?\s*[:=]\s*["']?)(?!\[hidden\])[^\s"'&,;}]{3,}/gi,
    `$1${MASK}`,
  ],
  // The same names in a URL's query string.
  [/([?&](?:token|api_?key|apikey|key|secret|signature|auth)=)[^&\s"']+/gi, `$1${MASK}`],
];

/** Secrets shorter than this are not blanked by value: they would also hit ordinary words. */
const MIN_SECRET_LENGTH = 8;

/** The text with credentials hidden. `secrets` are values this process holds, such as API tokens. */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[] = []) {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join(MASK);
  }
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
