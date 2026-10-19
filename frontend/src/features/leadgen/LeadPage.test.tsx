import type { BoardStageKey, CardEvent, CompanyCardDetail, CrmCard } from '@lead-gen-crm/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer, type FakeRequest } from '../../test/fakeServer.js';
import { dashboardRoutes, evidence, lead, page, runDetail } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { LeadPage } from './LeadPage.js';

const wrapped = (
  <Routes>
    <Route path="/leadgen/runs/:runId/leads/:leadId" element={<LeadPage />} />
  </Routes>
);

const ROUTE = '/leadgen/runs/run-1/leads/lead-1';
const NOW = '2026-10-18T09:30:00.000Z';

const card = (over: Partial<CrmCard> = {}): CrmCard => ({
  id: 'card-1',
  pipeline: 'companies',
  stage: 'found',
  stageEnteredAt: NOW,
  noiseAt: null,
  purgeAt: null,
  removedFrom: null,
  company: {
    id: 'co-1',
    name: 'Fixture Transport SARL',
    sector: 'textile',
    website: 'https://fixture-transport.example.test',
    phone: '+216 70 000 000',
    email: null,
    imageUrl: null,
    imageSource: null,
  },
  person: null,
  score: 77,
  ...over,
});

const detail = (over: Partial<CompanyCardDetail> = {}): CompanyCardDetail => ({
  card: card(),
  sectorName: 'Textile',
  notes: '',
  history: [{ from: null, to: 'found', at: NOW }],
  person: null,
  ...over,
});

/** A page whose CRM state lives in the fake server, so a change shows on the next read. */
function pageServer(opts: { lead?: ReturnType<typeof lead>; state?: CompanyCardDetail } = {}) {
  let state = opts.state ?? detail();
  const event = (from: BoardStageKey | null, to: BoardStageKey): CardEvent => ({
    from,
    to,
    at: NOW,
  });
  const set = (stage: BoardStageKey, extra: Partial<CrmCard> = {}) => {
    const next = { ...state.card, stage, ...extra };
    state = { ...state, card: next, history: [event(state.card.stage, stage), ...state.history] };
    return next;
  };
  const server = fakeServer({
    ...dashboardRoutes(),
    'GET /api/runs/run-1': { body: runDetail({ leads: [opts.lead ?? lead()] }) },
    'GET /api/crm/cards/by-company/co-1': () => state,
    'PATCH /api/crm/companies/co-1/notes': (req: FakeRequest) => {
      state = { ...state, notes: req.body.notes };
      return { notes: state.notes };
    },
    'POST /api/crm/cards/card-1/move': (req: FakeRequest) => set(req.body.stage),
    'POST /api/crm/cards/card-1/remove': () =>
      set('noise', {
        noiseAt: NOW,
        purgeAt: new Date(Date.now() + 30 * 86_400_000 - 3_600_000).toISOString(),
        removedFrom: state.card.stage,
      }),
    'POST /api/crm/cards/card-1/restore': () =>
      set('found', { noiseAt: null, purgeAt: null, removedFrom: null }),
    'POST /api/crm/cards/card-1/decision-maker': (req: FakeRequest) => {
      const person = card({
        id: 'card-2',
        pipeline: 'people',
        stage: 'new',
        person: {
          id: 'p-1',
          fullName: req.body.fullName,
          title: req.body.jobTitle ?? null,
          email: req.body.email ?? null,
          phone: req.body.phone ?? null,
          linkedinUrl: req.body.linkedinUrl ?? null,
          photoUrl: null,
        },
      });
      const company = set('decision_maker_identified');
      state = { ...state, person };
      return { company, person };
    },
  });
  return server;
}

const open = async (server: ReturnType<typeof pageServer>) => {
  renderWith(wrapped, server, ROUTE);
  return screen.findByRole('heading', { level: 1, name: 'Fixture Transport SARL' });
};
const tab = (name: string) => screen.getByRole('tab', { name });

describe('Lead page', () => {
  it('is one card with the back button, name and badges in its header', async () => {
    const heading = await open(pageServer());
    const header = heading.closest('header')!;
    expect(within(header).getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/leadgen/runs/run-1',
    );
    expect(within(header).getByText('Textile')).toBeVisible();
    expect(within(header).getByText(/77/)).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'You are here' })).toBeNull();
    expect(screen.queryByText('About the company')).toBeNull();
    expect(document.querySelector('main')).toHaveClass('page', 'fit', 'lead-page');
  });

  it('lists the contact rows with icons, links and copy buttons on the left', async () => {
    await open(
      pageServer({
        lead: lead({
          company: { ...lead().company, email: 'info@fixture-transport.example.test' },
        }),
      }),
    );
    const phone = screen.getByRole('link', { name: /Call/ });
    expect(phone.getAttribute('href')).toMatch(/^tel:/);
    expect(screen.getByRole('button', { name: /Copy phone number/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Email info@/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
    expect(screen.getByRole('button', { name: /Copy email address/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Open fixture-transport/ })).toBeVisible();
    expect(screen.getByText('Sfax')).toBeVisible();
    // No Fact or Estimate pills and no source under each value.
    expect(screen.queryByText('Fact')).toBeNull();
    expect(screen.queryByText('Estimate')).toBeNull();
    expect(screen.queryByText(/maps\.example\.test/)).toBeNull();
  });

  it('shows what a dot means in a tooltip on focus', async () => {
    const user = userEvent.setup();
    await open(pageServer());
    const dot = screen.getAllByRole('img', { name: /^Fact/ })[0]!;
    await user.tab();
    dot.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/read directly from a source/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('lists each value’s source and read time in one Sources popover', async () => {
    const user = userEvent.setup();
    await open(pageServer());
    expect(screen.queryByText('Where each value was read')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sources' }));
    const panel = await screen.findByRole('dialog', { name: 'Sources' });
    expect(within(panel).getByText('Where each value was read')).toBeVisible();
    expect(within(panel).getAllByText('maps.example.test').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/^read /).length).toBeGreaterThanOrEqual(3);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sources' })).toBeNull());
  });

  it('opens on Overview and moves between the tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    await open(pageServer());
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    tab('Overview').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Score')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Score')).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab('Notes')).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the total, three bars and the reasons as chips on Score', async () => {
    const user = userEvent.setup();
    await open(
      pageServer({
        lead: lead({
          scoreReasons: [
            {
              component: 'companyFit',
              points: 20,
              reason: 'qualified',
              kind: 'estimate',
              evidence: [],
            },
            {
              component: 'companyFit',
              points: 10,
              reason: 'freight sector',
              kind: 'fact',
              evidence: [],
            },
          ],
        }),
      }),
    );
    await user.click(tab('Score'));
    expect(screen.getAllByRole('meter')).toHaveLength(3);
    expect(document.querySelector('.score-big')).toHaveTextContent('77');
    expect(screen.getByText('+20 qualified')).toBeVisible();
    expect(screen.getByText('+10 freight sector')).toBeVisible();
  });

  it('keeps the raw values on Evidence, each group closed until opened', async () => {
    const user = userEvent.setup();
    const long = Array.from({ length: 60 }, (_, i) => evidence(`extra${i}`, `value ${i}`));
    const base = lead();
    await open(
      pageServer({
        lead: lead({ company: { ...base.company, evidence: [...base.company.evidence, ...long] } }),
      }),
    );
    await user.click(tab('Evidence'));
    const folds = document.querySelectorAll('details.evidence-fold');
    expect(folds.length).toBeGreaterThanOrEqual(3);
    for (const fold of folds) expect(fold).not.toHaveAttribute('open');
    // The place ID lives here, and nowhere on the other tabs.
    const record = screen.getByText('Record fields');
    await user.click(record);
    expect(screen.getAllByText('place-1').length).toBeGreaterThan(0);
    // A long list scrolls inside the right column, never the page.
    expect(document.querySelector('main')).toHaveClass('fit');
    expect(
      document.querySelector('.lead-col-right [role="tabpanel"]')!.closest('.lead-detail'),
    ).not.toBeNull();
  });

  describe('decision-maker', () => {
    it('says there is none and offers to add one', async () => {
      await open(pageServer({ lead: lead({ contact: null }) }));
      expect(screen.getByText('No decision-maker yet')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add decision-maker' })).toBeVisible();
    });

    it('opens the board’s modal, needs a name and a channel, then moves the company to the last stage', async () => {
      const user = userEvent.setup();
      const server = pageServer({ lead: lead({ contact: null }) });
      await open(server);
      await user.click(screen.getByRole('button', { name: 'Add decision-maker' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Save decision-maker' }));
      expect(within(dialog).getByText('Write their name.')).toBeVisible();
      expect(server.to('POST /api/crm/cards/card-1/decision-maker')).toHaveLength(0);

      await user.type(within(dialog).getByLabelText(/Full name/), 'Karim Test');
      await user.type(within(dialog).getByLabelText(/^Email/), 'karim@fixture.example.test');
      await user.click(within(dialog).getByRole('button', { name: 'Save decision-maker' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const sent = server.to('POST /api/crm/cards/card-1/decision-maker')[0]!;
      expect(sent.body).toMatchObject({ fullName: 'Karim Test' });
      expect(await screen.findByText('Karim Test')).toBeVisible();
      expect(screen.getByRole('radio', { name: 'Decision-maker identified' })).toBeChecked();
      expect(screen.getByText(/moved to Decision-maker identified/)).toBeVisible();
    });

    it('opens the same modal from the stage control and shows the person with channel icons', async () => {
      const user = userEvent.setup();
      const server = pageServer({ lead: lead({ contact: null }) });
      await open(server);
      await user.click(screen.getByRole('radio', { name: 'Decision-maker identified' }));
      expect(await screen.findByRole('dialog')).toBeVisible();
      expect(server.to('POST /api/crm/cards/card-1/move')).toHaveLength(0);
    });

    it('shows an existing person with call, email and LinkedIn icons', async () => {
      await open(pageServer());
      expect(screen.getByText('Amel Fixture')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Email Amel Fixture' })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Amel Fixture on LinkedIn' })).toBeVisible();
    });
  });

  describe('stage and remove', () => {
    it('moves the company between Found and Investigating', async () => {
      const user = userEvent.setup();
      const server = pageServer();
      await open(server);
      await user.click(screen.getByRole('radio', { name: 'Investigating' }));
      await waitFor(() => expect(server.to('POST /api/crm/cards/card-1/move')).toHaveLength(1));
      expect(server.to('POST /api/crm/cards/card-1/move')[0]!.body).toEqual({
        stage: 'investigating',
      });
      expect(await screen.findByRole('radio', { name: 'Investigating' })).toBeChecked();
    });

    it('offers the three board stages as one group the keyboard can reach', async () => {
      const user = userEvent.setup();
      await open(pageServer());
      const group = screen.getByRole('group', { name: 'Stage' });
      expect(
        within(group)
          .getAllByRole('radio')
          .map((r) => r.closest('label')?.textContent),
      ).toEqual(['Found', 'Investigating', 'Decision-maker identified']);
      screen.getByRole('radio', { name: 'Found' }).focus();
      await user.keyboard('{ArrowRight}');
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: 'Investigating' })).toBeChecked(),
      );
    });

    it('moves the company to Noise with the days left, and can restore it', async () => {
      const user = userEvent.setup();
      const server = pageServer();
      await open(server);
      await user.click(screen.getByRole('button', { name: 'Remove Fixture Transport SARL' }));
      await waitFor(() => expect(server.to('POST /api/crm/cards/card-1/remove')).toHaveLength(1));
      expect(await screen.findByText(/moved to Noise\. 30 days left/)).toBeVisible();
      expect(screen.getByText(/In Noise\./)).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Restore Fixture Transport SARL' }));
      await waitFor(() => expect(server.to('POST /api/crm/cards/card-1/restore')).toHaveLength(1));
      expect(await screen.findByRole('radio', { name: 'Found' })).toBeChecked();
    });
  });

  describe('notes', () => {
    it('saves the text per company and keeps it when switching tabs', async () => {
      const user = userEvent.setup();
      const server = pageServer({ state: detail({ notes: 'Called twice.' }) });
      await open(server);
      await user.click(tab('Notes'));
      const box = screen.getByRole('textbox', { name: 'Notes about this company' });
      expect(box).toHaveValue('Called twice.');
      const save = screen.getByRole('button', { name: 'Save notes' });
      expect(save).toBeDisabled();
      await user.type(box, ' Ask for the owner.');
      await user.click(tab('Score'));
      await user.click(tab('Notes'));
      expect(screen.getByRole('textbox', { name: 'Notes about this company' })).toHaveValue(
        'Called twice. Ask for the owner.',
      );
      await user.click(screen.getByRole('button', { name: 'Save notes' }));
      await waitFor(() =>
        expect(server.to('PATCH /api/crm/companies/co-1/notes')[0]!.body).toEqual({
          notes: 'Called twice. Ask for the owner.',
        }),
      );
      expect(await screen.findByText('Notes saved.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    });

    it('lists the stage changes with dates, read only, newest first', async () => {
      const user = userEvent.setup();
      await open(
        pageServer({
          state: detail({
            history: [
              { from: 'found', to: 'investigating', at: '2026-10-18T10:00:00.000Z' },
              { from: null, to: 'found', at: NOW },
            ],
          }),
        }),
      );
      await user.click(tab('Notes'));
      const items = within(document.querySelector('.history') as HTMLElement).getAllByRole(
        'listitem',
      );
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('Moved from Found to Investigating');
      expect(items[1]).toHaveTextContent('Added to Found');
    });
  });

  it('says so when the lead does not exist', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/runs/run-1': { body: runDetail({ leads: [] }) },
    });
    renderWith(wrapped, server, '/leadgen/runs/run-1/leads/nope');
    expect(await screen.findByText(/could not be found/)).toBeVisible();
  });

  it('looks further in the run when the lead is not on its first page', async () => {
    const server = pageServer();
    server.set('GET /api/runs/run-1', { body: runDetail({ leads: [lead({ id: 'other' })] }) });
    server.set('GET /api/leads', page([lead({ id: 'lead-1' })]));
    expect(await open(server)).toBeVisible();
  });
});
