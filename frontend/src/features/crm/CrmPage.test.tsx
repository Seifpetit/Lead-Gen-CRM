import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CrmStage, Lead } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { fakeServer, type Handler } from '../../test/fakeServer.js';
import { contact, lead, page } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { CrmPage } from './CrmPage.js';

/** A server that keeps leads in memory, the way the real one does. */
function crmServer(initial: Lead[]) {
  const leads = new Map(initial.map((l) => [l.id, l]));
  const routes: Record<string, Handler> = {
    'GET /api/leads': (req) => {
      const stages = (req.query.get('stage') ?? '').split(',');
      return page([...leads.values()].filter((l) => stages.includes(l.crmStage)));
    },
  };
  for (const l of initial) {
    routes[`PATCH /api/leads/${l.id}/stage`] = (req) => {
      const moved = { ...leads.get(l.id)!, crmStage: req.body.stage as CrmStage };
      leads.set(l.id, moved);
      return moved;
    };
    routes[`POST /api/leads/${l.id}/objection`] = () => {
      const moved = { ...leads.get(l.id)!, crmStage: 'opted_out' as const };
      leads.set(l.id, moved);
      return { lead: moved, suppressed: ['email', 'linkedin'] };
    };
  }
  const server = fakeServer(routes);
  renderWith(<CrmPage />, server);
  return { server, user: userEvent.setup() };
}

const column = (name: string) => screen.getByRole('region', { name });

describe('CRM board', () => {
  it('starts empty with a clear empty state and the pipeline columns', async () => {
    crmServer([]);
    expect(await screen.findByText('No leads in your pipeline yet')).toBeInTheDocument();
    for (const name of ['System suggested', 'Confirmed', 'Contacted (waiting)', 'Response']) {
      expect(column(name)).toBeInTheDocument();
    }
    expect(within(column('Confirmed')).getByText('Nothing here')).toBeInTheDocument();
  });

  it('keeps Dismissed, Won, Lost and Opted out in a collapsed area', async () => {
    const { user } = crmServer([lead({ id: 'a', crmStage: 'won' })]);
    const toggle = await screen.findByRole('button', { name: 'Show closed leads (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Won' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide closed leads' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const name of ['Dismissed', 'Won', 'Lost', 'Opted out']) {
      expect(column(name)).toBeInTheDocument();
    }
    expect(within(column('Won')).getByText('Amel Fixture')).toBeInTheDocument();
  });

  it('puts each lead in the column for its stage, with its fields tagged', async () => {
    crmServer([
      lead({ id: 'a', crmStage: 'system_suggested' }),
      lead({
        id: 'b',
        crmStage: 'contacted',
        contact: contact({ id: 'c2', fullName: 'Karim Fixture' }),
      }),
    ]);
    const suggested = await waitFor(() => column('System suggested'));
    await within(suggested).findByText('Amel Fixture');
    expect(within(suggested).getAllByText('Fact').length).toBeGreaterThan(0);
    expect(within(column('Contacted (waiting)')).getByText('Karim Fixture')).toBeInTheDocument();
  });

  it('moves a card by calling the API and shows it in its new column', async () => {
    const { server, user } = crmServer([lead({ id: 'a' })]);
    const suggested = await waitFor(() => column('System suggested'));
    await within(suggested).findByText('Amel Fixture');
    await user.selectOptions(
      within(suggested).getByLabelText('Move Amel Fixture to another stage'),
      'Contacted (waiting)',
    );
    expect(server.to('PATCH /api/leads/a/stage')[0]!.body).toEqual({ stage: 'contacted' });
    expect(
      await within(column('Contacted (waiting)')).findByText('Amel Fixture'),
    ).toBeInTheDocument();
    expect(within(column('System suggested')).queryByText('Amel Fixture')).not.toBeInTheDocument();
    expect(within(column('System suggested')).getByText('Nothing here')).toBeInTheDocument();
  });

  it('can move a lead through every stage', async () => {
    const { server, user } = crmServer([lead({ id: 'a' })]);
    await screen.findByText('Amel Fixture');
    const order: [string, string][] = [
      ['Confirmed', 'confirmed'],
      ['Contacted (waiting)', 'contacted'],
      ['Response', 'response'],
      ['Won', 'won'],
      ['Lost', 'lost'],
      ['Dismissed', 'dismissed'],
    ];
    for (const [label, stage] of order) {
      const select = await screen.findByLabelText('Move Amel Fixture to another stage');
      await user.selectOptions(select, label);
      await waitFor(() =>
        expect(server.to('PATCH /api/leads/a/stage').at(-1)!.body).toEqual({ stage }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Move Amel Fixture to another stage')).toBeEnabled(),
      );
    }
  });

  it('asks for confirmation and a reason before opting a lead out', async () => {
    const { server, user } = crmServer([lead({ id: 'a' })]);
    const suggested = await waitFor(() => column('System suggested'));
    await within(suggested).findByText('Amel Fixture');
    await user.selectOptions(
      within(suggested).getByLabelText('Move Amel Fixture to another stage'),
      'Opted out',
    );

    const dialog = await screen.findByRole('dialog', { name: 'Record an objection and opt out?' });
    expect(server.to('POST /api/leads/a/objection')).toHaveLength(0);
    expect(server.to('PATCH /api/leads/a/stage')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Record objection and opt out' }));
    expect(await within(dialog).findByText('Write the reason first.')).toBeInTheDocument();
    expect(server.to('POST /api/leads/a/objection')).toHaveLength(0);

    await user.type(
      within(dialog).getByLabelText('What did they say?'),
      'Asked by phone not to be contacted',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Record objection and opt out' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(server.to('POST /api/leads/a/objection')[0]!.body).toEqual({
      reason: 'Asked by phone not to be contacted',
    });
    expect(
      await screen.findByText('Objection recorded. 2 contact details are now suppressed.'),
    ).toBeInTheDocument();
    expect(within(column('System suggested')).queryByText('Amel Fixture')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show closed leads/ }));
    expect(within(column('Opted out')).getByText('Amel Fixture')).toBeInTheDocument();
  });

  it('cancelling the opt-out changes nothing, and Escape closes the dialog', async () => {
    const { server, user } = crmServer([lead({ id: 'a' })]);
    const suggested = await waitFor(() => column('System suggested'));
    await within(suggested).findByText('Amel Fixture');
    const select = within(suggested).getByLabelText('Move Amel Fixture to another stage');
    await user.selectOptions(select, 'Opted out');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.selectOptions(select, 'Opted out');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(server.calls.filter((c) => c.method !== 'GET' && !c.path.includes('csrf'))).toHaveLength(
      0,
    );
    expect(within(column('System suggested')).getByText('Amel Fixture')).toBeInTheDocument();
  });

  it('offers no way back out of Opted out', async () => {
    const { user } = crmServer([lead({ id: 'a', crmStage: 'opted_out' })]);
    await user.click(await screen.findByRole('button', { name: /Show closed leads/ }));
    const closed = within(column('Opted out'));
    await closed.findByText('Amel Fixture');
    expect(closed.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows an error when a move fails and leaves the card where it was', async () => {
    const { server, user } = crmServer([lead({ id: 'a' })]);
    server.set('PATCH /api/leads/a/stage', { status: 500, body: { error: 'internal' } });
    const suggested = await waitFor(() => column('System suggested'));
    await within(suggested).findByText('Amel Fixture');
    await user.selectOptions(
      within(suggested).getByLabelText('Move Amel Fixture to another stage'),
      'Confirmed',
    );
    expect(await within(suggested).findByRole('alert')).toHaveTextContent(
      'The server had a problem',
    );
    expect(within(suggested).getByText('Amel Fixture')).toBeInTheDocument();
  });

  it('shows an error with a retry when the board cannot load', async () => {
    const server = fakeServer({ 'GET /api/leads': { status: 500, body: { error: 'internal' } } });
    renderWith(<CrmPage />, server);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
