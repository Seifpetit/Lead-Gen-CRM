import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  describe('drawn on the page, for use inside something that scrolls', () => {
    const open = async () => {
      const view = render(
        <div style={{ overflow: 'hidden' }} data-testid="clip">
          <p>outside</p>
          <Popover label="Move to" icon={<span>i</span>} portal>
            {(close) => (
              <button type="button" onClick={close}>
                choose
              </button>
            )}
          </Popover>
        </div>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Move to' }));
      return view;
    };

    it('puts the panel outside its clipping parent, fixed, and closes it like any other', async () => {
      await open();
      const panel = screen.getByRole('dialog', { name: 'Move to' });
      expect(screen.getByTestId('clip')).not.toContainElement(panel);
      expect(panel.parentElement).toBe(document.body);
      expect(panel.style.position).toBe('fixed');

      // A click inside the panel is not "outside".
      await userEvent.click(screen.getByRole('button', { name: 'choose' }));
      expect(screen.queryByRole('dialog')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Move to' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Move to' })).toHaveFocus();

      await userEvent.click(screen.getByRole('button', { name: 'Move to' }));
      await userEvent.click(screen.getByText('outside'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('follows its button when something scrolls, and goes when the button has left the window', async () => {
      await open();
      const button = screen.getByRole('button', { name: 'Move to' });
      const at = (top: number) =>
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
          top,
          bottom: top + 36,
          left: 100,
          right: 136,
          width: 36,
          height: 36,
          x: 100,
          y: top,
          toJSON: () => ({}),
        });
      at(200);
      fireEvent.scroll(screen.getByTestId('clip'));
      expect(screen.getByRole('dialog', { name: 'Move to' }).style.top).toBe('242px');
      at(-500);
      fireEvent.scroll(screen.getByTestId('clip'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps its events from reaching the parents of the button', async () => {
      const seen: string[] = [];
      render(
        <div onMouseDown={() => seen.push('down')} onKeyDown={() => seen.push('key')}>
          <Popover label="Menu" icon={<span>i</span>} portal>
            <button type="button">inside</button>
          </Popover>
        </div>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
      seen.length = 0;
      await userEvent.click(screen.getByRole('button', { name: 'inside' }));
      expect(seen).toEqual([]);
    });
  });
});
