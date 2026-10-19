import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { renderWith } from '../../test/render.js';
import { ExportButton } from './ExportButton.js';

const file = (name: string) => ({
  body: {},
  headers: { 'content-disposition': `attachment; filename="${name}"` },
});

afterEach(() => window.localStorage.clear());

describe('ExportButton', () => {
  it('says how many leads and exports the current filters as a semicolon CSV', async () => {
    const s = fakeServer({ 'GET /api/exports/cards/companies': file('leads-2026-10-19.csv') });
    renderWith(
      <ExportButton
        source={{
          kind: 'cards',
          pipeline: 'companies',
          filters: { q: 'huile', minScore: 40, excludeNoise: true, cursor: 'x', limit: 50 },
        }}
        count={32}
      />,
      s,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export 32 leads' }));
    await userEvent.click(screen.getByRole('radio', { name: 'CSV' }));
    expect(screen.getByRole('radio', { name: 'Semicolon (French Excel)' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Download spreadsheet' }));
    await waitFor(() => expect(s.to('GET /api/exports/cards/companies')).toHaveLength(1));
    const q = s.to('GET /api/exports/cards/companies')[0]!.query;
    expect(Object.fromEntries(q)).toEqual({
      q: 'huile',
      minScore: '40',
      excludeNoise: 'true',
      format: 'csv',
      delimiter: 'semicolon',
    });
    expect(await screen.findByText('Downloaded leads-2026-10-19.csv')).toBeInTheDocument();
  });

  it('exports a run’s leads as a PDF table and says when the PDF is cut', async () => {
    const s = fakeServer({ 'GET /api/exports/leads': file('leads.pdf') });
    renderWith(<ExportButton source={{ kind: 'leads', runIds: ['r1', 'r2'] }} count={800} />, s);
    await userEvent.click(screen.getByRole('button', { name: 'Export 800 leads' }));
    expect(screen.getByText('The PDF holds the first 500 leads.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(s.to('GET /api/exports/leads')).toHaveLength(1));
    expect(Object.fromEntries(s.to('GET /api/exports/leads')[0]!.query)).toEqual({
      runIds: 'r1,r2',
      format: 'pdf',
    });
  });

  it('has nothing to export when the filters match nothing', async () => {
    renderWith(
      <ExportButton source={{ kind: 'leads', runIds: ['r1'] }} count={0} />,
      fakeServer({}),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export 0 leads' }));
    expect(screen.getByText('Nothing to export with these filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download spreadsheet' })).toBeDisabled();
  });
});
