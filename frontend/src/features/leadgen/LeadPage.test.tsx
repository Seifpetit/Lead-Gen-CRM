import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { dashboardRoutes, lead, page, runDetail } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { LeadPage } from './LeadPage.js';

const wrapped = (
  <Routes>
    <Route path="/leadgen/runs/:runId/leads/:leadId" element={<LeadPage />} />
  </Routes>
);

describe('Lead page', () => {
  it('shows the lead with a breadcrumb and a Back link to its run', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/runs/run-1': { body: runDetail({ leads: [lead()] }) },
    });
    renderWith(wrapped, server, '/leadgen/runs/run-1/leads/lead-1');
    expect(await screen.findByRole('article', { name: 'Amel Fixture' })).toBeVisible();
    const crumbs = screen.getByRole('navigation', { name: 'You are here' });
    expect(within(crumbs).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/leadgen',
    );
    expect(within(crumbs).getByRole('link', { name: 'Run in sfax' })).toBeVisible();
    expect(within(crumbs).getByText('Fixture Transport SARL')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/leadgen/runs/run-1',
    );
  });

  it('looks further in the run when the lead is not on its first page', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/runs/run-1': { body: runDetail({ leads: [lead({ id: 'other' })] }) },
      'GET /api/leads': page([lead({ id: 'lead-7' })]),
    });
    renderWith(wrapped, server, '/leadgen/runs/run-1/leads/lead-7');
    expect(await screen.findByRole('article')).toBeVisible();
  });

  it('says so when the lead does not exist', async () => {
    const server = fakeServer({
      ...dashboardRoutes(),
      'GET /api/runs/run-1': { body: runDetail({ leads: [] }) },
    });
    renderWith(wrapped, server, '/leadgen/runs/run-1/leads/nope');
    expect(await screen.findByText(/could not be found/)).toBeVisible();
  });
});
