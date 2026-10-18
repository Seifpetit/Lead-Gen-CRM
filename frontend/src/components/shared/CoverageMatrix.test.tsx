import type { Coverage } from '@lead-gen-crm/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { CoverageMatrix } from './CoverageMatrix.js';

const data: Coverage = {
  regions: [
    { regionId: 'sfax', name: 'Sfax' },
    { regionId: 'tunis', name: 'Tunis' },
  ],
  sectors: [
    { id: 'agri-food', name: 'Agri-food' },
    { id: 'textile', name: 'Textile' },
  ],
  entries: [
    {
      regionId: 'sfax',
      sectorId: 'agri-food',
      queriesRun: 12,
      newPlaces: 40,
      leads: 5,
      spendUsd: 2.5,
      costPerLeadUsd: 0.5,
      state: 'yielding',
    },
  ],
};

function setup() {
  const onPick = vi.fn();
  const { container } = render(
    <I18nProvider>
      <CoverageMatrix data={data} onPick={onPick} />
    </I18nProvider>,
  );
  return { onPick, container, user: userEvent.setup() };
}

describe('CoverageMatrix', () => {
  it('draws a square per region and sector, coloured by state', () => {
    setup();
    const squares = within(screen.getByRole('table')).getAllByRole('button');
    expect(squares).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Sfax, Agri-food.*Still yielding/ })).toHaveClass(
      'grid-yielding',
    );
    expect(screen.getByRole('button', { name: /Tunis, Textile.*Not searched/ })).toHaveClass(
      'grid-not_searched',
    );
  });

  it('hands the region and sector to onPick on click', async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole('button', { name: /Tunis, Textile/ }));
    expect(onPick).toHaveBeenCalledWith({ regionId: 'tunis', sectorIds: ['textile'] });
  });

  it('switches to fullscreen and back, and Escape leaves fullscreen', async () => {
    const { container, user } = setup();
    const view = container.querySelector('.matrix-view')!;
    await user.click(screen.getByRole('radio', { name: 'Fullscreen' }));
    expect(view).toHaveClass('is-fullscreen');
    await user.keyboard('{Escape}');
    expect(view).not.toHaveClass('is-fullscreen');
    expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked();
  });
});
