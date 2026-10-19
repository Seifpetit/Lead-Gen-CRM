import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Navigate, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { BoardPage } from './BoardPage.js';
import {
  SECTORS,
  STAGES,
  ago,
  boardServer,
  card,
  column,
  companyCard,
  inDays,
  menu,
  personCard,
} from './boardTestKit.js';
import { CrmSection } from './CrmSection.js';

describe('Companies board', () => {
  it('shows the four columns, Noise collapsed, and what each card carries', async () => {
    boardServer('companies', [companyCard({ id: 'alpha', name: 'Alpha Textile' })]);
    expect(await screen.findByRole('group', { name: 'Alpha Textile' })).toBeInTheDocument();
    for (const name of ['Found', 'Investigating', 'Decision-maker identified', 'Noise']) {
      expect(column(name)).toBeInTheDocument();
    }
    const alpha = within(card('Alpha Textile'));
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
    // The city and Google's category under the name; the sector and the rest are in the tooltip.
    expect(alpha.getByText('Sfax · Corporate office')).toBeInTheDocument();
    expect(alpha.getByText('Sfax · Corporate office')).toHaveAttribute(
      'title',
      expect.stringContaining('Textile'),
    );
    expect(alpha.getByRole('link', { name: 'Website of Alpha Textile' })).toHaveAttribute(
      'href',
      'https://www.alpha.example.test/',
    );
    expect(alpha.getByRole('link', { name: 'Phone: +216 74 111 222' })).toHaveAttribute(
      'href',
      'tel:+21674111222',
    );
    expect(alpha.getByRole('link', { name: 'Email: contact@alpha.example.test' })).toHaveAttribute(
      'href',
      'mailto:contact@alpha.example.test',
    );
    expect(alpha.getByText('Score 72')).toBeVisible();
    // The whole card is the drag handle.
    expect(card('Alpha Textile')).toHaveAttribute('aria-roledescription', 'draggable card');
    // The count in a header is the column's true total; Noise starts collapsed.
    expect(within(column('Found')).getByLabelText('1 in total')).toHaveTextContent('1');
    expect(within(column('Noise')).getByRole('button', { name: 'Show Noise (0)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(column('Noise')).queryByText('Nothing here')).not.toBeInTheDocument();
  });

  it('says so when there are no companies yet', async () => {
    boardServer('companies', []);
    expect(await screen.findByText('No companies on the board yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Lead Gen' })).toHaveAttribute(
      'href',
      '/leadgen',
    );
  });

  it('moves a card from its menu at once, and the server keeps it there', async () => {
    const { server, user } = boardServer('companies', [
      companyCard({ id: '1', name: 'Alpha Textile' }),
    ]);
    await screen.findByRole('group', { name: 'Alpha Textile' });
    await menu(user, 'Alpha Textile', 'Investigating');
    expect(within(column('Investigating')).getByText('Alpha Textile')).toBeInTheDocument();
    await waitFor(() => expect(server.to('POST /api/crm/cards/1/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/1/move')[0]!.body).toEqual({ stage: 'investigating' });
    expect(await screen.findByText('Alpha Textile moved to Investigating.')).toBeInTheDocument();
    expect(within(column('Investigating')).getByText('Alpha Textile')).toBeInTheDocument();
  });

  it('puts the card back and says why when the server refuses the move', async () => {
    const { user } = boardServer('companies', [companyCard({ id: '1', name: 'Alpha Textile' })], {
      reject: () => ({
        status: 409,
        body: { error: 'decision_maker_required', message: 'x' },
      }),
    });
    await screen.findByRole('group', { name: 'Alpha Textile' });
    await menu(user, 'Alpha Textile', 'Investigating');
    expect(
      await screen.findByText('Alpha Textile could not be moved: Add the decision-maker first.'),
    ).toBeInTheDocument();
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
    expect(within(column('Investigating')).queryByText('Alpha Textile')).not.toBeInTheDocument();
  });

  describe('the decision-maker form', () => {
    async function open() {
      const ctx = boardServer('companies', [companyCard({ id: '1', name: 'Alpha Textile' })]);
      await screen.findByRole('group', { name: 'Alpha Textile' });
      await menu(ctx.user, 'Alpha Textile', 'Decision-maker identified');
      return {
        ...ctx,
        dialog: await screen.findByRole('dialog', {
          name: 'Who is the decision-maker at Alpha Textile?',
        }),
      };
    }

    it('opens when a card is dropped in the last column, and the card waits there without a request', async () => {
      const { server } = await open();
      expect(
        within(column('Decision-maker identified')).getByText('Alpha Textile'),
      ).toBeInTheDocument();
      expect(server.to('POST /api/crm/cards/1/move')).toHaveLength(0);
      expect(server.to('POST /api/crm/cards/1/decision-maker')).toHaveLength(0);
    });

    it('puts the card back in its column when cancelled', async () => {
      const { user, dialog } = await open();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
      expect(
        within(column('Decision-maker identified')).queryByText('Alpha Textile'),
      ).not.toBeInTheDocument();
    });

    it('needs a name and at least one way to reach them', async () => {
      const { server, user, dialog } = await open();
      const save = within(dialog).getByRole('button', { name: 'Save decision-maker' });
      await user.click(save);
      expect(within(dialog).getByText('Write their name.')).toBeInTheDocument();
      await user.type(within(dialog).getByLabelText('Full name'), 'Amel Ben Salah');
      await user.click(save);
      expect(
        within(dialog).getByText('Add an email, a phone number or a LinkedIn address.'),
      ).toBeInTheDocument();
      await user.type(within(dialog).getByLabelText('Email'), 'not-an-email');
      await user.click(save);
      expect(
        within(dialog).getByText('This does not look like an email address.'),
      ).toBeInTheDocument();
      await user.clear(within(dialog).getByLabelText('Email'));
      await user.type(
        within(dialog).getByLabelText('LinkedIn address'),
        'https://example.test/in/amel',
      );
      await user.click(save);
      expect(
        within(dialog).getByText('Use a linkedin.com address that starts with https://'),
      ).toBeInTheDocument();
      expect(server.to('POST /api/crm/cards/1/decision-maker')).toHaveLength(0);
    });

    it('saves, moves the company and says what was added', async () => {
      const { server, user, dialog } = await open();
      await user.type(within(dialog).getByLabelText('Full name'), ' Amel Ben Salah ');
      await user.type(within(dialog).getByLabelText('Job title'), 'Responsable logistique');
      await user.type(within(dialog).getByLabelText('Phone'), '98 000 111');
      await user.click(within(dialog).getByRole('button', { name: 'Save decision-maker' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(server.to('POST /api/crm/cards/1/decision-maker')[0]!.body).toEqual({
        fullName: 'Amel Ben Salah',
        title: 'Responsable logistique',
        phone: '98 000 111',
      });
      expect(
        screen.getByText('Amel Ben Salah added. Alpha Textile moved to Decision-maker identified.'),
      ).toBeInTheDocument();
      expect(
        within(column('Decision-maker identified')).getByText('Alpha Textile'),
      ).toBeInTheDocument();
    });

    it('stays open with the reason when the server refuses, and the company does not move', async () => {
      const { server, user, dialog } = await open();
      server.set('POST /api/crm/cards/1/decision-maker', {
        status: 409,
        body: { error: 'suppressed', message: 'x' },
      });
      await user.type(within(dialog).getByLabelText('Full name'), 'Amel');
      await user.type(within(dialog).getByLabelText('Email'), 'amel@alpha.example.test');
      await user.click(within(dialog).getByRole('button', { name: 'Save decision-maker' }));
      expect(
        await within(dialog).findByText(
          'This person asked not to be contacted, so they cannot be added.',
        ),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
    });
  });

  it('removes a card to Noise with its days left, and restores it', async () => {
    const { server, user } = boardServer('companies', [
      companyCard({ id: '1', name: 'Alpha Textile' }),
    ]);
    await screen.findByRole('group', { name: 'Alpha Textile' });
    await user.click(
      within(card('Alpha Textile')).getByRole('button', { name: 'Remove Alpha Textile' }),
    );
    expect(
      await screen.findByText(/Alpha Textile moved to Noise\. 30 days left\./),
    ).toBeInTheDocument();
    expect(server.to('POST /api/crm/cards/1/remove')).toHaveLength(1);
    // Noise is collapsed: open it to see the card, what it was and when it goes.
    await user.click(within(column('Noise')).getByRole('button', { name: 'Show Noise (1)' }));
    const removed = within(card('Alpha Textile'));
    expect(removed.getByText('Removed from Found · 30 days left')).toBeInTheDocument();
    await user.click(removed.getByRole('button', { name: 'Restore Alpha Textile' }));
    expect(await screen.findByText('Alpha Textile restored to Found.')).toBeInTheDocument();
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
  });

  it('rolls a removal back when the server refuses', async () => {
    const { server, user } = boardServer('companies', [
      companyCard({ id: '1', name: 'Alpha Textile' }),
    ]);
    await screen.findByRole('group', { name: 'Alpha Textile' });
    server.set('POST /api/crm/cards/1/remove', { status: 500, body: { error: 'internal' } });
    await user.click(
      within(card('Alpha Textile')).getByRole('button', { name: 'Remove Alpha Textile' }),
    );
    expect(await screen.findByText(/Alpha Textile could not be removed/)).toBeInTheDocument();
    expect(within(column('Found')).getByText('Alpha Textile')).toBeInTheDocument();
  });

  it('offers no way into the last column from Noise, only back to a working one', async () => {
    const { user } = boardServer('companies', [
      companyCard({
        id: '1',
        name: 'Alpha Textile',
        stage: 'noise',
        noiseAt: ago(2),
        purgeAt: inDays(28),
        removedFrom: 'found',
      }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Show Noise (1)' }));
    await user.click(
      within(card('Alpha Textile')).getByRole('button', { name: 'Move Alpha Textile to' }),
    );
    const items = within(screen.getByRole('list', { name: 'Move to' })).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['Found', 'Investigating']);
  });
});

describe('People board', () => {
  it('shows the seven columns and the person, title, company and channels', async () => {
    boardServer('people', [personCard({ id: '1' })]);
    await screen.findByRole('group', { name: 'Amel Ben Salah' });
    for (const name of ['New', 'Contacted', 'Replied', 'Won', 'Lost', 'Opted out', 'Noise']) {
      expect(column(name)).toBeInTheDocument();
    }
    const amel = within(within(column('New')).getByRole('group', { name: 'Amel Ben Salah' }));
    expect(amel.getByText('Responsable logistique · Alpha SARL')).toBeInTheDocument();
    expect(amel.getByRole('link', { name: 'Email: amel@alpha.example.test' })).toBeInTheDocument();
    expect(amel.getByRole('link', { name: 'LinkedIn profile of Amel Ben Salah' })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/amel',
    );
    expect(amel.queryByRole('link', { name: /^Phone/ })).not.toBeInTheDocument();
    expect(amel.getByRole('heading', { name: 'Amel Ben Salah' })).toBeInTheDocument();
  });

  it('explains the empty board and points to the Companies board', async () => {
    boardServer('people', []);
    expect(await screen.findByText('No decision-makers yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Companies' })).toHaveAttribute(
      'href',
      '/crm/companies',
    );
  });

  it('moves a person through the board', async () => {
    const { user } = boardServer('people', [personCard({ id: '1' })]);
    await screen.findByRole('group', { name: 'Amel Ben Salah' });
    for (const to of ['Contacted', 'Replied', 'Won']) {
      await menu(user, 'Amel Ben Salah', to);
      expect(await screen.findByText(`Amel Ben Salah moved to ${to}.`)).toBeInTheDocument();
      expect(within(column(to)).getByText('Amel Ben Salah')).toBeInTheDocument();
    }
  });

  it('asks for the objection reason before opting out, and then the card has no controls', async () => {
    const { server, user } = boardServer('people', [personCard({ id: '1' })]);
    await screen.findByRole('group', { name: 'Amel Ben Salah' });
    await menu(user, 'Amel Ben Salah', 'Opted out');
    const dialog = await screen.findByRole('dialog', { name: 'Record an objection and opt out?' });
    // Nothing moved or was sent yet.
    expect(within(column('New')).getByText('Amel Ben Salah')).toBeInTheDocument();
    expect(server.to('POST /api/crm/cards/1/move')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Record objection and opt out' }));
    expect(within(dialog).getByText('Write the reason first.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('What did they say?'), 'Asked by phone to stop');
    await user.click(within(dialog).getByRole('button', { name: 'Record objection and opt out' }));
    await waitFor(() => expect(server.to('POST /api/crm/cards/1/move')).toHaveLength(1));
    expect(server.to('POST /api/crm/cards/1/move')[0]!.body).toEqual({
      stage: 'opted_out',
      reason: 'Asked by phone to stop',
    });
    expect(within(column('Opted out')).getByText('Amel Ben Salah')).toBeInTheDocument();
    const done = within(card('Amel Ben Salah'));
    expect(done.getByText('Opted out for good')).toBeInTheDocument();
    expect(done.queryByRole('button', { name: /Remove|Move/ })).not.toBeInTheDocument();
    expect(card('Amel Ben Salah')).not.toHaveAttribute('aria-roledescription');
  });

  it('puts the person back when the opt-out is refused', async () => {
    const { user } = boardServer('people', [personCard({ id: '1' })], {
      reject: () => ({ status: 500, body: { error: 'internal' } }),
    });
    await screen.findByRole('group', { name: 'Amel Ben Salah' });
    await menu(user, 'Amel Ben Salah', 'Opted out');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What did they say?'), 'Asked to stop');
    await user.click(within(dialog).getByRole('button', { name: 'Record objection and opt out' }));
    expect(await screen.findByText(/Amel Ben Salah could not be moved/)).toBeInTheDocument();
    expect(within(column('New')).getByText('Amel Ben Salah')).toBeInTheDocument();
  });
});

describe('the CRM section', () => {
  it('switches between the two boards with tabs, one page each', async () => {
    const board = (pipeline: 'companies' | 'people', cards: unknown[]) => ({
      pipeline,
      stages: STAGES[pipeline].map((s, i) => ({
        ...s,
        total: i === 0 ? cards.length : 0,
        cards: i === 0 ? cards : [],
        nextCursor: null,
      })),
      sectors: SECTORS,
    });
    const server = fakeServer({
      'GET /api/crm/companies': board('companies', [
        companyCard({ id: '1', name: 'Alpha Textile' }),
      ]),
      'GET /api/crm/people': board('people', [personCard({ id: '2' })]),
    });
    renderWith(
      <Routes>
        <Route path="/crm" element={<CrmSection />}>
          <Route index element={<Navigate to="/crm/companies" replace />} />
          <Route path="companies" element={<BoardPage pipeline="companies" />} />
          <Route path="people" element={<BoardPage pipeline="people" />} />
        </Route>
      </Routes>,
      server,
      '/crm',
    );
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'CRM', level: 1 })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'CRM boards' });
    expect(within(tabs).getByRole('tab', { name: 'Companies' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('group', { name: 'Alpha Textile' })).toBeInTheDocument();
    await user.click(within(tabs).getByRole('tab', { name: 'People' }));
    expect(await screen.findByRole('group', { name: 'Amel Ben Salah' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'People' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('group', { name: 'Alpha Textile' })).not.toBeInTheDocument();
    await user.click(within(tabs).getByRole('tab', { name: 'Companies' }));
    expect(await screen.findByRole('group', { name: 'Alpha Textile' })).toBeInTheDocument();
  });
});
