import { runProgress } from '@lead-gen-crm/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../i18n/index.js';
import { run } from '../../../test/fixtures.js';
import { Checkpoints } from './Checkpoints.js';

function show(over: Parameters<typeof run>[0], halted = false, compact = false) {
  const r = run(over);
  return render(
    <I18nProvider>
      <Checkpoints funnel={r.funnel} progress={runProgress(r)} halted={halted} compact={compact} />
    </I18nProvider>,
  );
}

const steps = () =>
  within(screen.getByRole('list', { name: 'Steps of this run' })).getAllByRole('listitem');

describe('Checkpoints', () => {
  it('lists the six steps in order with plain names', () => {
    show({ status: 'running', currentStage: 'find_people', finishedAt: null });
    expect(steps().map((li) => li.querySelector('.cp-label')?.textContent)).toEqual([
      'Searching Google Maps',
      'Checking companies',
      'Finding people',
      'Finding contacts',
      'Scoring',
      'Done',
    ]);
  });

  it('marks finished, current and coming steps, and writes the state out for screen readers', () => {
    show({ status: 'running', currentStage: 'find_people', finishedAt: null });
    const states = steps().map((li) => li.getAttribute('data-state'));
    expect(states).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
    expect(within(steps()[0]!).getByText('finished')).toBeInTheDocument();
    expect(within(steps()[2]!).getByText('in progress')).toBeInTheDocument();
    expect(within(steps()[4]!).getByText('not started')).toBeInTheDocument();
  });

  it('shows a count with each step that has begun, and a dash for the rest', () => {
    show({
      status: 'running',
      currentStage: 'find_people',
      finishedAt: null,
      funnel: {
        discovered: 24,
        skipped: 0,
        qualified: 12,
        rejected: 12,
        review: 0,
        unreachable: 0,
        peopleFound: 5,
        enriched: 0,
        scored: 0,
        leads: 0,
      },
    });
    const text = steps().map((li) => li.querySelector('.cp-count')?.textContent);
    expect(text).toEqual(['24 found', '12 fit', '5 people', '—', '—', '—']);
  });

  it('shows all six as finished, with the lead count, for a finished run', () => {
    show({ status: 'finished' });
    expect(steps().map((li) => li.getAttribute('data-state'))).toEqual(Array(6).fill('done'));
    expect(steps()[5]!.querySelector('.cp-count')).toHaveTextContent('6 leads');
  });

  it('marks where a stopped run stopped', () => {
    show({ status: 'cancelled', currentStage: 'qualify' }, true);
    expect(steps().map((li) => li.getAttribute('data-state'))).toEqual([
      'done',
      'halted',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    expect(within(steps()[1]!).getByText('stopped here')).toBeInTheDocument();
  });

  it('uses no internal stage names', () => {
    const { container } = show({ status: 'running', currentStage: 'verify', finishedAt: null });
    expect(container.textContent).not.toMatch(/discover|qualif|enrich|unreachable|verify/i);
  });

  it('keeps every name for hovering and screen readers in the compact form', () => {
    show({ status: 'finished' }, false, true);
    expect(steps()[0]).toHaveAttribute('title', 'Searching Google Maps');
    expect(screen.getByText('Searching Google Maps')).toBeInTheDocument();
  });
});
