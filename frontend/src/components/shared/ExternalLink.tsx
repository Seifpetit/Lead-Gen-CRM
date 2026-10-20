import { useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';
import { domainOf, setSkipsPanel, skipsPanel, type LinkKind } from '../../lib/externalOpen.js';
import { ExternalOpenPanel } from './ExternalOpenPanel.js';

/**
 * A link out of the app (a company's website, its Google Maps place, a LinkedIn profile). It is
 * a real link, so hovering shows the address, but a click opens our panel first unless the
 * person ticked "don't ask again" for this kind of link.
 */
export function ExternalLink({
  href,
  kind,
  name,
  children,
  ...rest
}: {
  href: string;
  kind: LinkKind;
  /** Who the link is about ("Huilerie Baccar"), shown in the panel. */
  name?: string | null;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel' | 'onClick'>) {
  const t = useT();
  const [asking, setAsking] = useState(false);

  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (skipsPanel(kind)) return;
    event.preventDefault();
    // The click belongs to the link: a card around it must not open as well.
    event.stopPropagation();
    setAsking(true);
  };

  return (
    <>
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer" onClick={click}>
        {children}
      </a>
      {asking && (
        <ExternalOpenPanel
          title={t(`external.title.${kind}`)}
          href={href}
          primaryLabel={t(`external.open.${kind}`)}
          skipLabel={t(`external.skip.${kind}`)}
          onOpened={(skip) => {
            if (skip) setSkipsPanel(kind, true);
          }}
          onClose={() => setAsking(false)}
        >
          {name && <p className="external-name">{t('external.name', { name })}</p>}
          <p>{t('external.body')}</p>
          <p className="external-target" dir="ltr" title={href}>
            {domainOf(href)}
          </p>
        </ExternalOpenPanel>
      )}
    </>
  );
}
