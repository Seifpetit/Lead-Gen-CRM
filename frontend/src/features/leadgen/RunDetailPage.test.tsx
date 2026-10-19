import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer, type Handler } from '../../test/fakeServer.js';
import { company, contact, lead, page, runDetail } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { RunDetailPage } from './RunDetailPage.js';

function show(routes: Record<string, Handler>) {
  const server = fakeServer({ 'GET /api/runs/run-1': { body: runDetail() }, ...routes });
  renderWith(
    <Routes>
      <Route path="/leadgen/runs/:runId" element={<RunDetailPage />} />
    </Routes>,
    server,
    '/leadgen/runs/run-1',
  );
  return { server, user: userEvent.setup() };
}

describe('Run detail', () => {
  it('shows how many places were dropped for lying outside the region', async () => {
    show({ 'GET /api/runs/run-1': { body: runDetail({ placesDroppedOutside: 17 }) } });
    expect(await screen.findByTestId('dropped-outside')).toHaveTextContent(
      'Places outside the region, dropped before qualifying: 17',
    );
  });

  it('lists the person first, then the company as the fallback', async () => {
    show({});
    const card = await screen.findByRole('article', { name: 'Amel Fixture' });
    const headings = within(card)
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent);
    expect(headings.slice(0, 3)).toEqual(['Decision-maker', 'Company channel (fallback)', 'Score']);

    const person = within(card).getByRole('region', { name: 'Decision-maker' });
    expect(within(person).getByText('Amel Fixture')).toBeInTheDocument();
    expect(within(person).getByText('Responsable logistique')).toBeInTheDocument();
    expect(
      within(person).getByRole('link', { name: 'linkedin.com/in/amel-fixture' }),
    ).toHaveAttribute('href', 'https://www.linkedin.com/in/amel-fixture');
    // Best channel is the email, which was inferred, so it is an estimate.
    const channel = within(person).getByText('Best channel').closest('div')!;
    expect(
      within(channel).getByRole('link', { name: 'amel@fixture-transport.example.test' }),
    ).toHaveAttribute('href', 'mailto:amel@fixture-transport.example.test');
    expect(within(channel).getByText('Estimate')).toBeInTheDocument();
  });

  it('tags each field with Fact or Estimate, its source and the time', async () => {
    show({});
    const card = await screen.findByRole('article');
    const title = within(card).getByText('Title').closest('div')!;
    expect(within(title).getByText('Fact')).toBeInTheDocument();
    expect(within(title).getByRole('link', { name: 'www.linkedin.com' })).toBeInTheDocument();
    expect(within(title).getByText(/Read 18 Oct 2026, 09:30 UTC/)).toBeInTheDocument();
  });

  it('shows missing values as not found and never invents them', async () => {
    const bare = lead({
      company: company({ phone: null, website: null, evidence: [] }),
      contact: contact({ email: null, phone: null, linkedinUrl: null, evidence: [] }),
    });
    show({ 'GET /api/runs/run-1': { body: runDetail({ leads: [bare], leadsTotal: 1 }) } });
    const card = await screen.findByRole('article');
    expect(within(card).getByText('No contact channel found')).toBeInTheDocument();
    const channel = within(card).getByText('Best channel').closest('div')!;
    expect(within(channel).getByText('Not found')).toBeInTheDocument();
    expect(within(card).queryByText(/@/)).not.toBeInTheDocument();
    // Values that exist but have no evidence are flagged, not given a source.
    expect(within(card).getAllByText('No source recorded').length).toBeGreaterThan(0);
  });

  it('shows a company with no decision-maker', async () => {
    show({
      'GET /api/runs/run-1': {
        body: runDetail({ leads: [lead({ contact: null })], leadsTotal: 1 }),
      },
    });
    expect(await screen.findByText('No decision-maker found at this company')).toBeInTheDocument();
  });

  it('shows the score as an estimate with the evidence it rests on', async () => {
    show({});
    const card = await screen.findByRole('article');
    const score = within(card).getByRole('region', { name: 'Score' });
    expect(within(score).getByText('40 of 50')).toBeInTheDocument();
    expect(within(score).getByText('25 of 30')).toBeInTheDocument();
    expect(within(score).getByText('12 of 20')).toBeInTheDocument();
    expect(within(score).getByText(/A score is a computed estimate/)).toBeInTheDocument();
    await userEvent.click(within(score).getByText('Evidence behind this lead'));
    expect(within(score).getAllByText('email').length).toBeGreaterThan(0);
  });

  it('moves a lead into the CRM from the run', async () => {
    const { server, user } = show({
      'PATCH /api/leads/lead-1/stage': { body: lead({ crmStage: 'confirmed' }) },
    });
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(server.to('PATCH /api/leads/lead-1/stage')[0]!.body).toEqual({ stage: 'confirmed' });
    expect(await screen.findByText('Moved to Confirmed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
  });

  it('shows an empty state while a run has no leads yet', async () => {
    show({
      'GET /api/runs/run-1': {
        body: runDetail({ status: 'running', currentStage: 'qualify', leads: [], leadsTotal: 0 }),
      },
    });
    expect(await screen.findByText('No leads from this run yet')).toBeInTheDocument();
    expect(screen.getByText('Leads appear here as the run scores them.')).toBeInTheDocument();
  });

  it('loads more leads', async () => {
    const second = lead({
      id: 'lead-2',
      contact: contact({ id: 'ct-2', fullName: 'Karim Fixture' }),
    });
    const { server, user } = show({
      'GET /api/runs/run-1': { body: runDetail({ leadsTotal: 2 }) },
      'GET /api/leads': { body: page([second], 2) },
    });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('article', { name: 'Karim Fixture' })).toBeInTheDocument();
    expect(server.to('GET /api/leads')[0]!.query.get('runId')).toBe('run-1');
  });

  it('asks before stopping an active run', async () => {
    const { server, user } = show({
      'GET /api/runs/run-1': { body: runDetail({ status: 'running', currentStage: 'discover' }) },
      'POST /api/runs/run-1/stop': { body: runDetail({ status: 'cancelled' }) },
    });
    await user.click(await screen.findByRole('button', { name: 'Stop run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop this run?' });
    expect(server.to('POST /api/runs/run-1/stop')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
    expect(server.to('POST /api/runs/run-1/stop')).toHaveLength(1);
  });

  it('says so when the run does not exist', async () => {
    show({ 'GET /api/runs/run-1': { status: 404, body: { error: 'not_found' } } });
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists');
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument();
  });
});
