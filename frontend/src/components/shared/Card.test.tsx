import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card.js';

describe('Card', () => {
  it('is a region named by its title, with the action beside it and the body inside', () => {
    render(
      <Card title="Costs" actions={<button type="button">Refresh</button>} anchor="costs">
        <p>Body text</p>
      </Card>,
    );
    const card = screen.getByRole('region', { name: 'Costs' });
    expect(card).toHaveAttribute('id', 'costs');
    expect(within(card).getByRole('heading', { name: 'Costs', level: 2 })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(within(card).getByText('Body text')).toBeVisible();
  });

  it('has no action area without actions', () => {
    const { container } = render(<Card title="Plain">x</Card>);
    expect(container.querySelector('.widget-actions')).toBeNull();
  });

  it('marks the colour of its header band when given a tone', () => {
    render(
      <Card title="Costs" tone="orange">
        x
      </Card>,
    );
    expect(screen.getByRole('region', { name: 'Costs' })).toHaveAttribute('data-tone', 'orange');
  });
});
