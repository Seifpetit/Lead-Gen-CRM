import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { ChipMultiSelect, type ChipItem } from './ChipMultiSelect.js';

const items: ChipItem[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
  { id: 'd', label: 'Delta' },
  { id: 'x', label: 'Locked', disabled: true },
];

function Harness({ initial = [], seen }: { initial?: string[]; seen?: (ids: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <ChipMultiSelect
      legend="Letters"
      items={items}
      selected={selected}
      onChange={(ids) => {
        seen?.(ids);
        setSelected(ids);
      }}
      countText={(n, total) => `${n} of ${total}`}
    />
  );
}

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const on = () =>
  Array.from(document.querySelectorAll('[aria-pressed="true"]'))
    .map((b) => b.textContent!.trim())
    .sort();

function setup(initial: string[] = [], seen?: (ids: string[]) => void) {
  render(
    <I18nProvider>
      <Harness initial={initial} {...(seen ? { seen } : {})} />
    </I18nProvider>,
  );
  return userEvent.setup();
}

afterEach(() => vi.restoreAllMocks());

describe('ChipMultiSelect', () => {
  it('toggles one chip on a press and again on the next', async () => {
    const user = setup();
    await user.click(chip('Alpha'));
    expect(on()).toEqual(['Alpha']);
    await user.click(chip('Alpha'));
    expect(on()).toEqual([]);
  });

  it('gives every chip a visible checkbox that follows its state', async () => {
    const user = setup();
    const box = () => chip('Bravo').querySelector('.chip-box')!;
    expect(box().querySelector('svg')).toBeNull();
    await user.click(chip('Bravo'));
    expect(box().querySelector('svg')).not.toBeNull();
    expect(box()).toHaveAttribute('aria-hidden', 'true');
  });

  describe('press and drag', () => {
    it('paints every chip it passes over to the state the first chip was given', async () => {
      const user = setup();
      await user.pointer([
        { keys: '[MouseLeft>]', target: chip('Alpha') },
        { target: chip('Bravo') },
        { target: chip('Charlie') },
        { keys: '[/MouseLeft]' },
      ]);
      expect(on()).toEqual(['Alpha', 'Bravo', 'Charlie']);
      expect(chip('Delta')).toHaveAttribute('aria-pressed', 'false');
    });

    it('paints off when the first chip was on: the drag clears what it passes', async () => {
      const user = setup(['a', 'b', 'c', 'd']);
      await user.pointer([
        { keys: '[MouseLeft>]', target: chip('Bravo') },
        { target: chip('Charlie') },
        { keys: '[/MouseLeft]' },
      ]);
      expect(on()).toEqual(['Alpha', 'Delta']);
    });

    it('uses the first chip’s new state even for chips that are already in that state', async () => {
      const user = setup(['b']);
      // Alpha is off, so the drag turns on: Bravo (already on) stays on, Charlie goes on.
      await user.pointer([
        { keys: '[MouseLeft>]', target: chip('Alpha') },
        { target: chip('Bravo') },
        { target: chip('Charlie') },
        { keys: '[/MouseLeft]' },
      ]);
      expect(on()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('stops painting when the button is released, and a later move changes nothing', async () => {
      const user = setup();
      await user.pointer([
        { keys: '[MouseLeft>]', target: chip('Alpha') },
        { keys: '[/MouseLeft]' },
        { target: chip('Bravo') },
        { target: chip('Charlie') },
      ]);
      expect(on()).toEqual(['Alpha']);
    });

    it('does nothing while no button is held', async () => {
      const user = setup();
      await user.pointer([{ target: chip('Alpha') }, { target: chip('Bravo') }]);
      expect(on()).toEqual([]);
    });

    it('reports the selection in the order of the chips, once per change', async () => {
      const seen = vi.fn();
      const user = setup([], seen);
      await user.pointer([
        { keys: '[MouseLeft>]', target: chip('Charlie') },
        { target: chip('Bravo') },
        { target: chip('Alpha') },
        { keys: '[/MouseLeft]' },
      ]);
      expect(seen.mock.calls.map((c) => c[0])).toEqual([['c'], ['b', 'c'], ['a', 'b', 'c']]);
    });

    it('skips a disabled chip, whether it is pressed or dragged over', async () => {
      const user = setup();
      await user.click(chip('Locked'));
      expect(on()).toEqual([]);
      await user.pointer([
        { keys: '[MouseLeft>]', target: chip('Delta') },
        { target: chip('Locked') },
        { keys: '[/MouseLeft]' },
      ]);
      expect(on()).toEqual(['Delta']);
    });

    it('ignores the right mouse button', async () => {
      const user = setup();
      await user.pointer([
        { keys: '[MouseRight>]', target: chip('Alpha') },
        { keys: '[/MouseRight]' },
      ]);
      expect(on()).toEqual([]);
    });

    it('does not select text: the chips are not selectable and a drag start is cancelled', () => {
      setup();
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      chip('Alpha').dispatchEvent(drag);
      expect(drag.defaultPrevented).toBe(true);
    });

    it('works with a finger: it keeps to the chip it started on, so the chip under it is looked up', () => {
      setup();
      const under = { current: 'Alpha' };
      // jsdom has no layout; say which chip is under the finger at each move.
      document.elementFromPoint = vi.fn(() => chip(under.current));
      try {
        fireEvent.pointerDown(chip('Alpha'), { pointerType: 'touch', pointerId: 7, clientX: 1 });
        for (const name of ['Bravo', 'Charlie']) {
          under.current = name;
          fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 7, clientX: 2 });
        }
        fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 7 });
        under.current = 'Delta';
        fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 7, clientX: 3 });
        expect(on()).toEqual(['Alpha', 'Bravo', 'Charlie']);
      } finally {
        // @ts-expect-error: jsdom does not define it, so there is nothing to restore
        delete document.elementFromPoint;
      }
    });
  });

  describe('keyboard', () => {
    it('toggles just the focused chip with Space, and with Enter', async () => {
      const user = setup();
      chip('Bravo').focus();
      await user.keyboard(' ');
      expect(on()).toEqual(['Bravo']);
      await user.keyboard('{Enter}');
      expect(on()).toEqual([]);
      await user.keyboard('{Enter}');
      expect(on()).toEqual(['Bravo']);
      await user.tab();
      await user.keyboard(' ');
      expect(on()).toEqual(['Bravo', 'Charlie']);
    });

    it('lets a screen reader activate a chip (a click with no pointer behind it)', () => {
      setup();
      fireEvent.click(chip('Delta'));
      expect(on()).toEqual(['Delta']);
    });
  });

  describe('Select all and Deselect all', () => {
    it('select every chip that can be chosen, and clear them', async () => {
      const user = setup();
      await user.click(screen.getByRole('button', { name: 'Select all' }));
      expect(on()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
      expect(screen.getByText('4 of 4')).toBeVisible();
      expect(chip('Locked')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Deselect all' }));
      expect(on()).toEqual([]);
      expect(screen.getByRole('button', { name: 'Deselect all' })).toBeDisabled();
    });

    it('keep what is chosen when selecting all, and report the order of the chips', async () => {
      const seen = vi.fn();
      const user = setup(['d'], seen);
      await user.click(screen.getByRole('button', { name: 'Select all' }));
      expect(seen).toHaveBeenLastCalledWith(['a', 'b', 'c', 'd']);
    });
  });
});
