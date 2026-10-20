import type { ApifyLog, ApifyLogRun, RunLogLine } from '@lead-gen-crm/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer } from '../../../test/fakeServer.js';
import { emptyApifyLog, run } from '../../../test/fixtures.js';
import { renderWith } from '../../../test/render.js';
import { exportFileName, exportText, RUN_SEPARATOR } from './exportText.js';
import { LogsView } from './LogsView.js';
import { I18nProvider, useT } from '../../../i18n/index.js';
import { render } from '@testing-library/react';

const bizerte: ApifyLogRun = {
  run: run({
    id: 'run-biz',
    region: 'bizerte',
    sectors: [],
    createdAt: '2026-10-19T09:00:00.000Z',
    finishedAt: '2026-10-19T09:30:00.000Z',
    spentUsd: 0.553,
    budgetCapUsd: 2,
  }),
  steps: [],
};
const sfax: ApifyLogRun = {
  run: run({
    id: 'run-sfax',
    region: 'sfax',
    sectors: [],
    createdAt: '2026-10-18T09:00:00.000Z',
    spentUsd: 1.2,
    budgetCapUsd: 2,
  }),
  steps: [],
};
const line = (id: number, at: string, message: string): RunLogLine => ({
  id,
  at,
  level: 'info',
  message,
  technical: false,
});

const server = (extra: Parameters<typeof fakeServer>[0] = {}) =>
  fakeServer({
    'GET /api/apify/log': (): ApifyLog => ({ ...emptyApifyLog(), runs: [sfax, bizerte] }),
    'GET /api/runs/run-biz/logs': {
      items: [line(1, '2026-10-19T09:00:01.000Z', 'Starting Bizerte')],
      hasMore: false,
    },
    'GET /api/runs/run-sfax/logs': {
      items: [line(7, '2026-10-18T09:00:02.000Z', 'Starting Sfax')],
      hasMore: false,
    },
    ...extra,
  });

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const rows = () =>
  within(screen.getByRole('list', { name: 'Runs, newest first' })).getAllByRole('listitem');

async function enterExport() {
  const user = userEvent.setup();
  await screen.findByText('Bizerte, 19 Oct');
  await user.click(screen.getByRole('button', { name: 'Export' }));
  return user;
}

afterEach(() => vi.restoreAllMocks());

describe('Logs export mode', () => {
  it('shows checkboxes only in export mode, with nothing picked and Copy and Download off', async () => {
    renderWith(<LogsView />, server());
    await screen.findByText('Bizerte, 19 Oct');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await enterExport();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.getByText('0 selected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download .txt' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('picks a run by clicking its row instead of opening the run window', async () => {
    renderWith(<LogsView />, server());
    const user = await enterExport();
    await user.click(within(rows()[0]!).getByText('Bizerte, 19 Oct'));
    expect(screen.getByRole('checkbox', { name: 'Pick the run Bizerte, 19 Oct' })).toBeChecked();
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(within(rows()[0]!).getByText('Bizerte, 19 Oct'));
    expect(screen.getByText('0 selected')).toBeVisible();
  });

  it('selects all the runs the filters show, then clears them', async () => {
    renderWith(<LogsView />, server());
    const user = await enterExport();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 selected')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeVisible();
  });

  it('cancels with the button or Escape, which clears the picks and hides the checkboxes', async () => {
    renderWith(<LogsView />, server());
    const user = await enterExport();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByText('0 selected')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('copies one block per run, newest first, with a header and the log lines', async () => {
    renderWith(<LogsView />, server());
    const user = await enterExport();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied 2 runs')).toBeVisible();
    const text = await navigator.clipboard.readText();
    expect(text).toBe(
      [
        'Run run-biz | Bizerte | All sectors | Started 2026-10-19T09:00:00.000Z | Completed with leads | Spent $0.553 of $2.00',
        '2026-10-19T09:00:01.000Z INFO  Starting Bizerte',
        '',
        RUN_SEPARATOR,
        '',
        'Run run-sfax | Sfax | All sectors | Started 2026-10-18T09:00:00.000Z | Completed with leads | Spent $1.20 of $2.00',
        '2026-10-18T09:00:02.000Z INFO  Starting Sfax',
        '',
      ].join('\n'),
    );
  });

  it('only reads and exports the runs that were picked', async () => {
    const s = server();
    renderWith(<LogsView />, s);
    const user = await enterExport();
    await user.click(within(rows()[1]!).getByText('Sfax, 18 Oct'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied 1 run')).toBeVisible();
    expect(s.to('GET /api/runs/run-sfax/logs').length).toBeGreaterThan(0);
    expect(s.to('GET /api/runs/run-biz/logs')).toHaveLength(0);
  });

  it('downloads leadgen-logs-YYYY-MM-DD.txt as UTF-8 text', async () => {
    const make = vi.fn((_blob: Blob) => 'blob:logs');
    Object.assign(URL, { createObjectURL: make, revokeObjectURL: vi.fn() });
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    renderWith(<LogsView />, server());
    const user = await enterExport();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Download .txt' }));
    await waitFor(() => expect(make).toHaveBeenCalledTimes(1));
    expect(name).toMatch(/^leadgen-logs-\d{4}-\d{2}-\d{2}\.txt$/);
    const blob = make.mock.calls[0]![0] as unknown as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await readBlob(blob)).toContain('Starting Sfax');
    expect(await screen.findByText(/^Saved 2 runs as leadgen-logs-/)).toBeVisible();
  });

  it('says so when a log cannot be read', async () => {
    renderWith(<LogsView />, server({ 'GET /api/runs/run-sfax/logs': { status: 500, body: {} } }));
    const user = await enterExport();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/^Could not read the logs/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('masks a token that reaches a log line, even if the server missed it', async () => {
    const token = 'apify_api_AbCdEf1234567890';
    renderWith(
      <LogsView />,
      server({
        'GET /api/runs/run-biz/logs': {
          items: [
            line(1, '2026-10-19T09:00:01.000Z', `Calling with ${token}`),
            line(2, '2026-10-19T09:00:02.000Z', 'GET /v2/runs?token=abcdef123456&x=1'),
          ],
          hasMore: false,
        },
      }),
    );
    const user = await enterExport();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Copied 2 runs');
    const text = await navigator.clipboard.readText();
    expect(text).not.toContain('AbCdEf1234567890');
    expect(text).not.toContain('abcdef123456');
    expect(text).toContain('Calling with apify_api_[hidden]');
  });
});

describe('exportText', () => {
  function Text({ go }: { go: (t: ReturnType<typeof useT>) => string }) {
    return <pre>{go(useT())}</pre>;
  }
  const make = (go: (t: ReturnType<typeof useT>) => string) =>
    render(
      <I18nProvider>
        <Text go={go} />
      </I18nProvider>,
    ).container.textContent;

  it('names the sectors, says "no log lines" for a quiet run and orders newest first', () => {
    const text = make((t) =>
      exportText(
        t,
        [
          { run: { ...sfax.run, sectors: ['textile'] }, lines: [] },
          { run: bizerte.run, lines: [] },
        ],
        (id) => (id === 'textile' ? 'Textile' : id),
      ),
    );
    expect(text!.indexOf('run-biz')).toBeLessThan(text!.indexOf('run-sfax'));
    expect(text).toContain('| Sfax | Textile |');
    expect(text).toContain('(no log lines)');
  });

  it('names the file by day', () => {
    expect(exportFileName(new Date('2026-10-20T23:59:00Z'))).toBe('leadgen-logs-2026-10-20.txt');
  });
});
