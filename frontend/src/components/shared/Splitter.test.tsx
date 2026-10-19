import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Splitter } from './Splitter.js';

function Harness({ onReset = () => undefined }: { onReset?: () => void }) {
  const [value, setValue] = useState(60);
  return (
    <div>
      <div style={{ height: 300 }} />
      <Splitter
        label="Resize"
        valueText={`${value} percent`}
        value={value}
        min={30}
        max={80}
        onChange={setValue}
        onReset={onReset}
      />
      <div style={{ height: 100 }} />
    </div>
  );
}
const bar = () => screen.getByRole('separator', { name: 'Resize' });

describe('Splitter', () => {
  it('is a focusable horizontal separator that says its value', () => {
    render(<Harness />);
    expect(bar()).toHaveAttribute('aria-orientation', 'horizontal');
    expect(bar()).toHaveAttribute('aria-valuenow', '60');
    expect(bar()).toHaveAttribute('aria-valuetext', '60 percent');
    expect(bar()).toHaveAttribute('tabindex', '0');
  });

  it('moves with the arrow keys, in bigger steps with Page keys, and stops at its limits', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    bar().focus();
    await user.keyboard('{ArrowDown}');
    expect(bar()).toHaveAttribute('aria-valuenow', '62');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(bar()).toHaveAttribute('aria-valuenow', '58');
    await user.keyboard('{PageDown}');
    expect(bar()).toHaveAttribute('aria-valuenow', '68');
    await user.keyboard('{End}');
    expect(bar()).toHaveAttribute('aria-valuenow', '80');
    await user.keyboard('{ArrowDown}');
    expect(bar()).toHaveAttribute('aria-valuenow', '80');
    await user.keyboard('{Home}');
    expect(bar()).toHaveAttribute('aria-valuenow', '30');
  });

  it('follows a drag by the share of the two sections it sits between', () => {
    render(<Harness />);
    const above = bar().previousElementSibling as HTMLElement;
    const below = bar().nextElementSibling as HTMLElement;
    // jsdom has no layout: say the two sections are 300 and 100 tall, 400 together.
    Object.defineProperty(above, 'offsetHeight', { value: 300 });
    Object.defineProperty(below, 'offsetHeight', { value: 100 });
    fireEvent.pointerDown(bar(), { button: 0, clientY: 300, pointerId: 1 });
    expect(bar()).toHaveClass('is-dragging');
    fireEvent.pointerMove(bar(), { clientY: 340, pointerId: 1 });
    expect(bar()).toHaveAttribute('aria-valuenow', '70');
    fireEvent.pointerMove(bar(), { clientY: 900, pointerId: 1 });
    expect(bar()).toHaveAttribute('aria-valuenow', '80');
    fireEvent.pointerUp(bar(), { pointerId: 1 });
    expect(bar()).not.toHaveClass('is-dragging');
    fireEvent.pointerMove(bar(), { clientY: 0, pointerId: 1 });
    expect(bar()).toHaveAttribute('aria-valuenow', '80');
  });

  it('is reset by a double-click', async () => {
    const onReset = vi.fn();
    render(<Harness onReset={onReset} />);
    await userEvent.dblClick(bar());
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
