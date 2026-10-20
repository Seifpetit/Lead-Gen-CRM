// Run logs are shown to people and downloaded as text, so nothing that works as a credential may
// reach them. Known secrets are blanked by value here; anything shaped like a token, key or
// password is blanked by pattern (the list lives in shared, so the Logs export uses the same one),
// in case an error message quotes a URL or header.
import { maskCredentials, MASK } from '@lead-gen-crm/shared';

/** Secrets shorter than this are not blanked by value: they would also hit ordinary words. */
const MIN_SECRET_LENGTH = 8;

/** The text with credentials hidden. `secrets` are values this process holds, such as API tokens. */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[] = []) {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join(MASK);
  }
  return maskCredentials(out);
}
