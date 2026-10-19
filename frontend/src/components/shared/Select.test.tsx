import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Select, type SelectOption } from './Select.js';

const OPTIONS: SelectOption[] = [
  { value: '', label: 'All regions' },
  { value: 'sfax', label: 'Sfax', secondary: '7 leads' },
  { value: 'sousse', label: 'Sousse' },
  { value: 'tunis', label: 'Tunis', disabled: true },
  { value: 'gabes', label: 'Gabès' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="r">Region</label>
      <Select id="r" value={value} onChange={setValue} options={OPTIONS} placeholder="Pick" />
      <output>{value || 'none'}</output>
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Region' });

describe('Select', () => {
  it('is named by its label, shows the chosen option and starts closed', () => {
    render(<Harness initial="sfax" />);
    expect(box()).toHaveTextContent('Sfax');
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a listbox of options with label and secondary text, the chosen one selected', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sfax" />);
    await user.click(box());
    const list = screen.getByRole('listbox');
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(box()).toHaveAttribute('aria-controls', list.id);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(5);
    expect(screen.getByRole('option', { name: 'Sfax, 7 leads' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Sousse' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('option', { name: 'Tunis' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('chooses with a click and closes, giving focus back', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'Sousse' }));
    expect(screen.getByRole('status')).toHaveTextContent('sousse');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box()).toHaveFocus();
  });

  it('moves with the arrow keys, skips disabled options, and chooses with Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    box().focus();
    await user.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]!.id);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    // Sfax, Sousse, then Tunis is disabled so Gabès comes next.
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[4]!.id);
    await user.keyboard('{ArrowUp}');
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]!.id);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('sousse');
  });

  it('jumps with Home and End and chooses with Space', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sfax" />);
    box().focus();
    await user.keyboard('{Enter}{End}');
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[4]!.id);
    await user.keyboard('{Home} ');
    expect(screen.getByRole('status')).toHaveTextContent('none');
  });

  it('finds an option by typing its first letters', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    box().focus();
    await user.keyboard('sou');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]!.id);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('sousse');
  });

  it('closes on Escape without leaving the page’s own Escape handlers to fire', async () => {
    const user = userEvent.setup();
    let outer = 0;
    document.addEventListener('keydown', () => outer++);
    render(<Harness />);
    await user.click(box());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box()).toHaveFocus();
    expect(outer).toBe(0);
  });

  it('closes on a click outside and on Tab, and does not choose a disabled option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'Tunis' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('none');
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(box());
    await user.tab();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the placeholder when no option matches, and does not open when disabled', async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="m">Move</label>
        <Select
          id="m"
          value=""
          onChange={() => {}}
          options={OPTIONS.slice(1)}
          placeholder="Move to…"
          disabled
        />
      </>,
    );
    const b = screen.getByRole('combobox', { name: 'Move' });
    expect(b).toHaveTextContent('Move to…');
    await user.click(b);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
