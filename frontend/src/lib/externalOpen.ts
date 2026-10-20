// What leaves the app goes through our own panel first. A person can say "don't ask again" for
// websites, Google Maps or LinkedIn; that choice is kept in this browser. WhatsApp always asks,
// because its message is edited in the panel.

export type LinkKind = 'website' | 'maps' | 'linkedin';

const key = (kind: LinkKind) => `leadgen.external.skip.${kind}`;

export function skipsPanel(kind: LinkKind): boolean {
  try {
    return window.localStorage.getItem(key(kind)) === '1';
  } catch {
    return false;
  }
}

export function setSkipsPanel(kind: LinkKind, skip: boolean): void {
  try {
    if (skip) window.localStorage.setItem(key(kind), '1');
    else window.localStorage.removeItem(key(kind));
  } catch {
    // Storage blocked (private mode): the panel simply keeps asking.
  }
}

/** "www.huilerie-baccar.tn" for a web address; the text itself when it is not one. */
export function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Where WhatsApp Web opens with the number and the message filled in. */
export const whatsappWebUrl = (digits: string, text: string) =>
  `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;

/** The same conversation in the phone app (wa.me hands over to it). */
export const whatsappAppUrl = (digits: string, text: string) =>
  `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
