import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover.js';

describe('Popover', () => {
  it('opens under its button, and closes on Escape, an outside click, or a choice', async () => {
    render(
      <>
        <p>outside</p>
        <Popover label="Display settings" icon={<span>i</span>}>
          {(close) => (
            <button type="button" onClick={close}>
              choose
            </button>
          )}
        </Popover>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Display settings' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeVisible();
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'choose' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('can write its label on the button', () => {
    render(
      <Popover label="Bulk actions" icon={<span>i</span>} showLabel>
        <p>menu</p>
      </Popover>,
    );
    expect(screen.getByRole('button', { name: 'Bulk actions' })).toHaveTextContent('Bulk actions');
  });
});
