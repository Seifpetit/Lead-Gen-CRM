import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { ExternalLink } from './ExternalLink.js';

const link = () =>
  render(
    <I18nProvider>
      <div onClick={() => document.body.setAttribute('data-card-opened', 'yes')}>
        <ExternalLink kind="website" name="Huilerie Baccar" href="https://www.baccar.tn/fr">
          baccar.tn
        </ExternalLink>
      </div>
    </I18nProvider>,
  );

afterEach(() => {
  window.localStorage.clear();
  document.body.removeAttribute('data-card-opened');
});

describe('ExternalLink', () => {
  it('asks in our own panel first, showing the domain, and opens only from its button', () => {
    link();
    const anchor = screen.getByRole('link', { name: 'baccar.tn' });
    expect(anchor).toHaveAttribute('href', 'https://www.baccar.tn/fr');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    const clicked = fireEvent.click(anchor);
    // The browser was not sent anywhere, and the card around the link did not open.
    expect(clicked).toBe(false);
    expect(document.body).not.toHaveAttribute('data-card-opened');
    const panel = screen.getByRole('dialog', { name: 'Open the website?' });
    expect(within(panel).getByText('www.baccar.tn')).toBeInTheDocument();
    expect(within(panel).getByText('For Huilerie Baccar')).toBeInTheDocument();
    const open = within(panel).getByRole('link', { name: 'Open website' });
    expect(open).toHaveAttribute('href', 'https://www.baccar.tn/fr');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body).not.toHaveAttribute('data-card-opened');
  });

  it('stops asking for websites once told so', () => {
    link();
    fireEvent.click(screen.getByRole('link', { name: 'baccar.tn' }));
    const panel = screen.getByRole('dialog');
    fireEvent.click(within(panel).getByLabelText('Don’t ask again for websites'));
    fireEvent.click(within(panel).getByRole('link', { name: 'Open website' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // The next click is a plain link click: no panel, nothing prevented.
    expect(fireEvent.click(screen.getByRole('link', { name: 'baccar.tn' }))).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
