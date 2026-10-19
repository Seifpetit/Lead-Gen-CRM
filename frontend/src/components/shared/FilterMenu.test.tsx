import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { FilterChips, FilterMenu, type FilterField } from './FilterMenu.js';

function Harness() {
  const [stage, setStage] = useState('all');
  const [score, setScore] = useState(0);
  const [sort, setSort] = useState('newest');
  const fields: FilterField[] = [
    {
      id: 'stage',
      type: 'choice',
      label: 'Stage',
      value: stage,
      options: [
        { value: 'all', label: 'All', count: 5 },
        { value: 'found', label: 'Found', count: 3 },
      ],
      onChange: setStage,
      filter: { active: stage !== 'all', chip: `Stage: ${stage}`, clear: () => setStage('all') },
    },
    {
      id: 'score',
      type: 'range',
      label: 'Minimum score',
      value: score,
      min: 0,
      max: 100,
      step: 5,
      valueText: `${score} or more`,
      onChange: setScore,
      filter: { active: score > 0, chip: `Score ${score}+`, clear: () => setScore(0) },
    },
    {
      id: 'sort',
      type: 'choice',
      label: 'Sort by',
      value: sort,
      options: [
        { value: 'newest', label: 'Newest' },
        { value: 'name', label: 'Name' },
      ],
      onChange: setSort,
    },
  ];
  return (
    <I18nProvider>
      <FilterMenu
        fields={fields}
        onReset={() => {
          setStage('all');
          setScore(0);
        }}
      />
      <FilterChips fields={fields} />
    </I18nProvider>
  );
}
const button = () => screen.getByRole('button', { name: /^Filters/ });

describe('FilterMenu', () => {
  it('shows no badge and no chips while nothing is active', () => {
    render(<Harness />);
    expect(button()).toHaveAccessibleName('Filters');
    expect(button().querySelector('.popover-badge')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('counts the active filters in the badge, and not the sort', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(button());
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    await user.click(within(panel).getByRole('radio', { name: 'Name' }));
    expect(button().querySelector('.popover-badge')).toBeNull();
    await user.click(within(panel).getByRole('radio', { name: /Found/ }));
    expect(button()).toHaveAccessibleName('Filters, 1 active');
    expect(button().querySelector('.popover-badge')).toHaveTextContent('1');
    fireEvent.change(within(panel).getByRole('slider'), { target: { value: '40' } });
    await waitFor(() => expect(button()).toHaveAccessibleName('Filters, 2 active'));
  });

  it('draws a chip per active filter, and a chip removes its filter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(button());
    await user.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /Found/ }));
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(1);
    await user.click(within(chips).getByRole('button', { name: 'Remove filter Stage: found' }));
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    // Clicking outside the panel closed it; opening it again shows the filter is off.
    await user.click(button());
    expect(within(screen.getByRole('dialog')).getByRole('radio', { name: /^All/ })).toBeChecked();
  });

  it('Reset puts every filter back and the chips go', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(button());
    const panel = screen.getByRole('dialog');
    const reset = within(panel).getByRole('button', { name: 'Reset' });
    expect(reset).toBeDisabled();
    await user.click(within(panel).getByRole('radio', { name: /Found/ }));
    fireEvent.change(within(panel).getByRole('slider'), { target: { value: '40' } });
    await waitFor(() => expect(button()).toHaveAccessibleName('Filters, 2 active'));
    await user.click(reset);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull());
    expect(button()).toHaveAccessibleName('Filters');
    expect(within(panel).getByRole('slider')).toHaveValue('0');
  });

  it('closes on Escape with the focus back on the button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(button());
    within(screen.getByRole('dialog')).getByRole('radio', { name: /Found/ }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });
});
