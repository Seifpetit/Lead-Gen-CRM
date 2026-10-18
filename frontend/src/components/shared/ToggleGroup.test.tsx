import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ToggleGroup } from './ToggleGroup.js';

const options = [
  { value: 'month', label: 'Month' },
  { value: 'run', label: 'Run' },
  { value: 'region', label: 'Region' },
] as const;

function Harness() {
  const [value, setValue] = useState<(typeof options)[number]['value']>('month');
  return <ToggleGroup label="Group by" options={options} value={value} onChange={setValue} />;
}

describe('ToggleGroup', () => {
  it('is a labelled group with the current option selected', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Group by' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Month' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Run' })).not.toBeChecked();
  });

  it('switches option on click and on arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('radio', { name: 'Region' }));
    expect(screen.getByRole('radio', { name: 'Region' })).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Run' })).toBeChecked();
  });
});
