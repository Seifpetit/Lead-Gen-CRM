import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberStepper } from './NumberStepper.js';

function Harness({
  initial = '2.00',
  min = 0.5,
  max = 50,
  step = 0.5,
}: {
  initial?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(initial);
  return (
    <>
      <label htmlFor="c">Cap</label>
      <NumberStepper
        id="c"
        prefix="$"
        value={text}
        onChange={setText}
        min={min}
        max={max}
        step={step}
        decimals={2}
      />
    </>
  );
}

const field = () => screen.getByRole('spinbutton', { name: 'Cap' });

afterEach(() => vi.useRealTimers());

describe('NumberStepper', () => {
  it('shows the unit and exposes its range to assistive tech', () => {
    render(<Harness />);
    expect(field()).toHaveValue('2.00');
    expect(field()).toHaveAttribute('aria-valuemin', '0.5');
    expect(field()).toHaveAttribute('aria-valuemax', '50');
    expect(field()).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('steps with the buttons and the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Increase' }));
    expect(field()).toHaveValue('2.50');
    await user.click(screen.getByRole('button', { name: 'Decrease' }));
    await user.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(field()).toHaveValue('1.50');
    field().focus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(field()).toHaveValue('2.50');
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('2.00');
  });

  it('never steps past the minimum or the maximum', async () => {
    const user = userEvent.setup();
    render(<Harness initial="0.50" />);
    field().focus();
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('0.50');
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled();
    await user.clear(field());
    await user.type(field(), '49.8');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(field()).toHaveValue('50.00');
    expect(screen.getByRole('button', { name: 'Increase' })).toBeDisabled();
  });

  it('starts from the minimum when empty', async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);
    await user.click(screen.getByRole('button', { name: 'Increase' }));
    expect(field()).toHaveValue('0.50');
  });

  it('keeps float noise out: 0.1 steps add up exactly', async () => {
    const user = userEvent.setup();
    render(<Harness initial="0.70" min={0} step={0.1} />);
    field().focus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(field()).toHaveValue('0.90');
  });

  it('repeats while a button is held, and stops on release', () => {
    vi.useFakeTimers();
    render(<Harness initial="1.00" step={1} />);
    const up = screen.getByRole('button', { name: 'Increase' });
    fireEvent.pointerDown(up, { button: 0 });
    expect(field()).toHaveValue('2.00');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    for (let i = 0; i < 3; i++) {
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }
    expect(field()).toHaveValue('5.00');
    fireEvent.pointerUp(up);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(field()).toHaveValue('5.00');
  });

  it('accepts a decimal comma and tidies the text when you leave the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.clear(field());
    await user.type(field(), '2,5');
    expect(field()).toHaveValue('2,5');
    expect(field()).toHaveAttribute('aria-valuenow', '2.5');
    await user.tab();
    expect(field()).toHaveValue('2.50');
  });

  it('does not clamp what is typed, so the caller can say what is wrong', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.clear(field());
    await user.type(field(), '5000000');
    await user.tab();
    expect(field()).toHaveValue('5000000');
  });
});
