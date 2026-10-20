import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { TemplateValues } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { ChipEditor, serializeEditor } from './ChipEditor.js';

function Harness({ initial, values }: { initial: string; values?: TemplateValues }) {
  const [value, setValue] = useState(initial);
  return (
    <I18nProvider>
      <span id="label">Text</span>
      <ChipEditor
        value={value}
        onChange={setValue}
        {...(values ? { values } : {})}
        labelledBy="label"
        maxLength={40}
      />
      <output data-testid="value">{value}</output>
    </I18nProvider>
  );
}

const box = () => screen.getByRole('textbox', { name: 'Text' });
const value = () => screen.getByTestId('value').textContent;

describe('ChipEditor', () => {
  it('shows variables as chips with their names, and keeps the template text as the value', () => {
    render(<Harness initial="Bonjour {person} de {company}" />);
    const chips = box().querySelectorAll('[data-var]');
    expect([...chips].map((c) => c.textContent)).toEqual(['person', 'company']);
    expect(chips[0]).toHaveAttribute('contenteditable', 'false');
    expect(serializeEditor(box())).toBe('Bonjour {person} de {company}');
  });

  it('shows a lead’s values in a preview, and a missing one in red', () => {
    render(
      <Harness
        initial="{company} {person}"
        values={{ company: 'Huilerie Baccar', person: null }}
      />,
    );
    const [company, person] = box().querySelectorAll('[data-var]');
    expect(company).toHaveTextContent('Huilerie Baccar');
    expect(person).toHaveTextContent('person: missing');
    expect(person).toHaveClass('is-missing');
  });

  it('inserts a chip from the menu and deletes it as one unit', async () => {
    render(<Harness initial="Bonjour " />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert variable' }));
    await userEvent.click(screen.getByRole('button', { name: 'company' }));
    expect(value()).toBe('Bonjour {company}');

    // The caret sits right after the chip: one Backspace removes the whole chip.
    const chip = box().querySelector('[data-var]')!;
    act(() => {
      const range = document.createRange();
      range.setStartAfter(chip);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    fireEvent.keyDown(box(), { key: 'Backspace' });
    expect(value()).toBe('Bonjour ');
    expect(box().querySelector('[data-var]')).toBeNull();
  });

  it('counts characters and says when the text is too long', () => {
    render(<Harness initial={'x'.repeat(41)} />);
    expect(screen.getByText('Too long: at most 40 characters.')).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps Arabic text and lets the box pick its direction', () => {
    render(<Harness initial="مرحبا {person}" />);
    expect(box()).toHaveAttribute('dir', 'auto');
    expect(serializeEditor(box())).toBe('مرحبا {person}');
  });
});
