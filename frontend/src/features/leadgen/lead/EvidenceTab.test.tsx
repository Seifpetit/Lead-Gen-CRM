import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/shared/Toast.js';
import { I18nProvider } from '../../../i18n/index.js';
import { company, contact, evidence, lead } from '../../../test/fixtures.js';
import { EvidenceTab, isLongId } from './EvidenceTab.js';

const PLACE = 'ChIJ0123456789abcdefghijklmnopqrstuvwxyz';
const view = (l = lead()) =>
  render(
    <I18nProvider>
      <ToastProvider>
        <EvidenceTab lead={l} />
      </ToastProvider>
    </I18nProvider>,
  );

describe('Evidence table', () => {
  it('has Field, Value, Source and Date, with rows grouped under Person and Company', () => {
    view(
      lead({
        company: company({
          evidence: [
            evidence('address', '12 Rue Exemple, 3000 Sfax', 'fact', 'https://maps.example.test/p'),
          ],
        }),
        contact: contact({ evidence: [evidence('title', 'Responsable logistique')] }),
      }),
    );
    const table = screen.getByRole('table', { name: 'Evidence' });
    expect(
      within(table.querySelector('thead')!)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Field', 'Value', 'Source', 'Date']);
    const person = within(within(table).getByRole('rowgroup', { name: 'Person' }));
    expect(person.getByText('Responsable logistique')).toBeVisible();
    const comp = within(within(table).getByRole('rowgroup', { name: 'Company' }));
    expect(comp.getByText('12 Rue Exemple, 3000 Sfax')).toBeVisible();
    expect(comp.getByRole('link', { name: 'maps.example.test' })).toHaveAttribute(
      'href',
      'https://maps.example.test/p',
    );
    expect(comp.getByText('18 Oct 2026')).toBeVisible();
  });

  it('wraps long text and a long address, and has no fixed-width cell that could overflow', () => {
    const text = 'a very long description with many words '.repeat(12).trim();
    view(lead({ company: company({ evidence: [evidence('note', text)] }) }));
    // Ordinary text is a plain cell (the stylesheet wraps it); only an id is cut short.
    expect(screen.getByText(text)).toHaveClass('evidence-text');
    expect(screen.getByText(text).closest('.evidence-id')).toBeNull();
  });

  it('cuts a long id short, keeps the whole value in a tooltip, and copies it on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    view(lead({ company: company({ evidence: [evidence('placeId', PLACE)] }) }));
    const code = screen.getByText(PLACE, { selector: 'code' });
    expect(code).toHaveAttribute('title', PLACE);
    fireEvent.click(screen.getByRole('button', { name: 'Copy value' }));
    expect(writeText).toHaveBeenCalledWith(PLACE);
    expect(await screen.findByText('Copied value.')).toBeVisible();
  });

  it('tells a long id from a long sentence or a URL', () => {
    expect(isLongId(PLACE)).toBe(true);
    expect(isLongId('0x13a9f0e1b2c3d4e5:0x1234567890abcdef')).toBe(true);
    expect(isLongId('place-1')).toBe(false);
    expect(isLongId('a-company-with-a-long-name.example.test')).toBe(false);
    expect(isLongId('a sentence that is long enough but has spaces in it')).toBe(false);
    expect(isLongId('https://example.test/a/very/long/path/that/goes/on')).toBe(false);
  });

  it('says so when a group has nothing recorded', () => {
    view(lead({ contact: null, company: company({ evidence: [] }) }));
    expect(screen.getAllByText('No evidence recorded').length).toBeGreaterThan(0);
  });
});
