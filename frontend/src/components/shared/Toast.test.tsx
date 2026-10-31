import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { ToastProvider, useToast } from './Toast.js';

function Buttons() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.show('Saved it.')}>
        ok
      </button>
      <button type="button" onClick={() => toast.show('That failed.', 'error')}>
        bad
      </button>
      <button
        type="button"
        onClick={() =>
          toast.show('Moved it.', 'success', { action: { label: 'Undo', onClick: undo } })
        }
      >
        moved
      </button>
    </>
  );
}
const undo = vi.fn();
const setup = () =>
  render(
    <I18nProvider>
      <ToastProvider>
        <Buttons />
      </ToastProvider>
    </I18nProvider>,
  );

afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('announces a confirmation politely and an error as an alert', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'ok' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved it.');
    await userEvent.click(screen.getByRole('button', { name: 'bad' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That failed.');
  });

  it('can be dismissed, and goes away on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'ok' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Saved it.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'ok' }));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByText('Saved it.')).toBeNull();
  });

  it('refuses to be used without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <I18nProvider>
          <Buttons />
        </I18nProvider>,
      ),
    ).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it('can carry an action that runs once and closes the toast', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'moved' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Moved it.')).toBeNull();
  });

  it('keeps a toast with an action for about 8 seconds, longer than a plain one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'moved' }));
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByText('Moved it.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.queryByText('Moved it.')).toBeNull();
  });
});
