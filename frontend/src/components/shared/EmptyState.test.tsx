import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('shows a title, text and an action', () => {
    render(
      <EmptyState title="No runs yet" action={<button type="button">Create run</button>}>
        Pick a region to start.
      </EmptyState>,
    );
    expect(screen.getByText('No runs yet')).toHaveClass('state-title');
    expect(screen.getByText('Pick a region to start.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create run' })).toBeVisible();
  });

  it('needs only a title', () => {
    const { container } = render(<EmptyState title="No active run" />);
    expect(screen.getByText('No active run')).toBeVisible();
    expect(container.querySelector('.state-body')).toBeNull();
    expect(container.querySelector('.state-action')).toBeNull();
  });
});
