import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { WhatsAppButton } from './WhatsAppButton.js';
import type { WhatsAppTarget } from './whatsapp.js';

const target = (over: Partial<WhatsAppTarget> = {}): WhatsAppTarget => ({
  companyId: 'c1',
  personId: null,
  company: 'Huilerie Baccar',
  sector: 'olive-oil',
  person: 'Amel Ben Salah',
  phone: '+216 98 123 456',
  ...over,
});

const server = () =>
  fakeServer({
    'GET /api/templates': {
      items: [
        {
          id: 't1',
          name: 'Premier',
          body: 'Bonjour {person}, {my_name} pour {company} ({sector}).',
          updatedAt: '',
        },
        { id: 't2', name: 'Court', body: 'Salut {company}', updatedAt: '' },
      ],
    },
    'GET /api/profile/sender': { name: 'Samia', company: 'Trans Sfax' },
    'POST /api/crm/contacts': { status: 201, body: { at: '2026-10-19T10:00:00.000Z' } },
  });

describe('WhatsAppButton', () => {
  it('is only offered for a Tunisian mobile', () => {
    renderWith(<WhatsAppButton target={target({ phone: '74 123 456' })} />, server());
    expect(screen.queryByRole('button', { name: /WhatsApp/ })).toBeNull();
  });

  it('wears the WhatsApp logo and says "Chat" for a computer, or the full words as a labelled button', () => {
    const small = renderWith(<WhatsAppButton target={target()} />, server());
    const icon = screen.getByRole('button', { name: 'Write to Amel Ben Salah on WhatsApp' });
    expect(icon.querySelector('svg.wa-logo')).not.toBeNull();
    // The brand green and no stand-in speech bubble.
    expect(icon.querySelector('svg.wa-logo rect')).toHaveAttribute('fill', '#25D366');
    expect(icon.querySelector('.lucide-message-circle')).toBeNull();
    expect(within(icon).getByText('Chat')).toBeInTheDocument();
    small.unmount();
    renderWith(<WhatsAppButton target={target()} variant="button" />, server());
    const big = screen.getByRole('button', { name: 'Write to Amel Ben Salah on WhatsApp' });
    expect(big.querySelector('svg.wa-logo')).not.toBeNull();
    expect(within(big).getByText('Chat on WhatsApp')).toBeInTheDocument();
  });

  it('previews the filled message, opens WhatsApp Web from the panel and notes the contact', async () => {
    const s = server();
    renderWith(<WhatsAppButton target={target()} variant="button" />, s);
    await userEvent.click(
      screen.getByRole('button', { name: 'Write to Amel Ben Salah on WhatsApp' }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Message on WhatsApp' });
    expect(within(panel).getByText('+216 98 123 456')).toBeInTheDocument();
    expect(
      within(panel).getByText('You send the message yourself; nothing is sent from here.'),
    ).toBeInTheDocument();
    const text = "Bonjour Amel Ben Salah, Samia pour Huilerie Baccar (l'huile d'olive).";
    const open = await within(panel).findByRole('link', { name: 'Open WhatsApp' });
    await waitFor(() =>
      expect(open).toHaveAttribute(
        'href',
        `https://web.whatsapp.com/send?phone=21698123456&text=${encodeURIComponent(text)}`,
      ),
    );
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(panel).getByRole('link', { name: 'Use the phone app instead' })).toHaveAttribute(
      'href',
      `https://wa.me/21698123456?text=${encodeURIComponent(text)}`,
    );
    // Chips show this lead's values.
    expect(
      within(panel).getByText('Huilerie Baccar', { selector: '[data-var]' }),
    ).toBeInTheDocument();

    await userEvent.click(open);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('WhatsApp opened for Amel Ben Salah')).toBeInTheDocument();
    await waitFor(() => expect(s.to('POST /api/crm/contacts')).toHaveLength(1));
    expect(s.to('POST /api/crm/contacts')[0]!.body).toEqual({
      channel: 'whatsapp',
      companyId: 'c1',
      personId: null,
    });
  });

  it('warns before opening when a variable has no value', async () => {
    renderWith(<WhatsAppButton target={target({ person: null })} variant="button" />, server());
    await userEvent.click(screen.getByRole('button', { name: /on WhatsApp/ }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('person: missing')).toHaveClass('is-missing');
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      'person has no value for this lead. It will be left out of the message.',
    );
    expect(within(panel).getByRole('link', { name: 'Open WhatsApp anyway' })).toBeInTheDocument();
  });
});
