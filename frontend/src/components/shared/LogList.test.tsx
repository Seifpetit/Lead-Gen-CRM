import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogList } from './LogList.js';

const items = [
  { id: 'a', content: 'Run started' },
  { id: 'b', content: 'Run finished' },
];

describe('LogList', () => {
  it('lists the events in the order given', () => {
    render(<LogList items={items} label="Latest events" emptyText="Nothing yet" />);
    const list = screen.getByRole('list', { name: 'Latest events' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Run started', 'Run finished']);
    expect(screen.queryByText('Nothing yet')).not.toBeInTheDocument();
  });

  it('shows the empty text when there are no events', () => {
    render(<LogList items={[]} label="Latest events" emptyText="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('offers to open the feed in a new window only when asked', () => {
    const { rerender } = render(
      <LogList
        items={items}
        label="Events"
        emptyText="-"
        newWindowHref="/leadgen/logs"
        newWindowLabel="Open new window"
      />,
    );
    const link = screen.getByRole('link', { name: 'Open new window' });
    expect(link).toHaveAttribute('href', '/leadgen/logs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    rerender(<LogList items={items} label="Events" emptyText="-" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
