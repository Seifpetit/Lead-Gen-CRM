import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs.js';

const tabs = [
  { id: 'all', label: 'All', count: 5 },
  { id: 'confirmed', label: 'Confirmed', count: 2 },
  { id: 'dismissed', label: 'Dismissed' },
] as const;

function Demo() {
  const [value, setValue] = useState<(typeof tabs)[number]['id']>('all');
  return (
    <Tabs label="Views" tabs={tabs} value={value} onChange={setValue}>
      <p>showing {value}</p>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('marks the selected tab, shows counts, and links the tab to its panel', () => {
    render(<Demo />);
    const all = screen.getByRole('tab', { name: /^All\s*5$/ });
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Confirmed\s*2$/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/All\s*5/);
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeVisible();
  });

  it('changes view on click and with the arrow keys', async () => {
    render(<Demo />);
    await userEvent.click(screen.getByRole('tab', { name: /Confirmed/ }));
    expect(screen.getByText('showing confirmed')).toBeVisible();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('showing dismissed')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Dismissed' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('showing all')).toBeVisible();
  });
});
