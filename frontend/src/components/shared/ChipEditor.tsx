import {
  parseTemplate,
  TEMPLATE_VARIABLES,
  type TemplateValues,
  type TemplateVariable,
} from '@lead-gen-crm/shared';
import { Braces } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useT, type Translate } from '../../i18n/index.js';
import { Popover } from './Popover.js';
import './external.css';

// A text box where {company}, {person} and the other variables are chips: blocks with a bold
// frame that are inserted from a menu, deleted as one unit and cannot be half-edited. The value
// is the template text ("Bonjour {person},"); the chips are only how it is shown.

/** Keeps a line break at the very end visible; never part of the value. */
const END = '\u200b';

const isChip = (node: Node | null | undefined): node is HTMLElement =>
  node instanceof HTMLElement && node.dataset.var !== undefined;

/** The editor's content written back as template text. */
export function serializeEditor(root: Node): string {
  let out = '';
  root.childNodes.forEach((node, i) => {
    if (node.nodeType === Node.TEXT_NODE) out += (node.textContent ?? '').replaceAll(END, '');
    else if (isChip(node)) out += `{${node.dataset.var}}`;
    else if (node.nodeName === 'BR') out += '\n';
    // A browser can wrap a new line in a <div>; it starts a line of its own.
    else out += (i > 0 ? '\n' : '') + serializeEditor(node);
  });
  return out;
}

export const variableLabel = (t: Translate, name: TemplateVariable) => t(`chips.var.${name}`);

/** How a chip reads: the variable's name in the template editor, the lead's value in a preview. */
function paintChip(chip: HTMLElement, t: Translate, values: TemplateValues | undefined) {
  const name = chip.dataset.var as TemplateVariable;
  const label = variableLabel(t, name);
  const value = values?.[name]?.trim();
  const missing = values !== undefined && !value;
  chip.textContent =
    values === undefined ? label : missing ? `${label}: ${t('chips.missing')}` : value!;
  chip.classList.toggle('is-missing', missing);
  chip.title =
    values === undefined
      ? `{${name}}`
      : missing
        ? t('chips.chipMissing', { name: label })
        : t('chips.chipLabel', { name: label, value: value! });
}

function makeChip(name: TemplateVariable, t: Translate, values: TemplateValues | undefined) {
  const chip = document.createElement('span');
  chip.className = 'chip-var';
  chip.setAttribute('contenteditable', 'false');
  chip.dataset.var = name;
  chip.dir = 'auto';
  paintChip(chip, t, values);
  return chip;
}

function fill(root: HTMLElement, value: string, t: Translate, values: TemplateValues | undefined) {
  root.replaceChildren(
    ...parseTemplate(value).map((part) =>
      part.kind === 'text' ? document.createTextNode(part.text) : makeChip(part.name, t, values),
    ),
  );
  if (value.endsWith('\n')) root.append(document.createTextNode(END));
}

export function ChipEditor({
  id,
  value,
  onChange,
  values,
  labelledBy,
  describedBy,
  maxLength,
  rows = 6,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** A lead's values: the chips then show them (a missing one in red). Left out in Settings. */
  values?: TemplateValues;
  labelledBy?: string;
  describedBy?: string;
  /** Shows a counter, red past the limit; the parent decides what that blocks. */
  maxLength?: number;
  rows?: number;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);

  // A value that did not come from typing here (a template picked, a reset) redraws the box.
  useLayoutEffect(() => {
    if (box.current && value !== emitted.current) {
      fill(box.current, value, t, values);
      emitted.current = value;
    }
    // Chips are repainted below when the values change; only the text matters here.
  }, [value]);

  useEffect(() => {
    box.current
      ?.querySelectorAll<HTMLElement>('[data-var]')
      .forEach((chip) => paintChip(chip, t, values));
  }, [t, values]);

  const emit = useCallback(() => {
    if (!box.current) return;
    const next = serializeEditor(box.current);
    emitted.current = next;
    onChange(next);
  }, [onChange]);

  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && box.current?.contains(sel.getRangeAt(0).startContainer)) {
      saved.current = sel.getRangeAt(0).cloneRange();
    }
  };

  /**
   * Where new text goes. Typing (Enter, paste) uses the live caret; the menu, which takes focus
   * away, uses the caret remembered when the box lost focus, or the end of the text.
   */
  const caret = (live: boolean): Range => {
    const root = box.current!;
    const sel = window.getSelection();
    if (live && sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
      return sel.getRangeAt(0);
    }
    if (saved.current && root.contains(saved.current.startContainer)) return saved.current;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    return range;
  };

  const place = (node: Node) => {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    saved.current = range.cloneRange();
  };

  const insert = (node: Node, live = true) => {
    const range = caret(live);
    range.deleteContents();
    range.insertNode(node);
    // A line break as the last thing needs something after it to show.
    const root = box.current!;
    if (node.textContent === '\n' && node === root.lastChild)
      root.append(document.createTextNode(END));
    if (!live) root.focus();
    place(node);
    emit();
  };

  const insertVariable = (name: TemplateVariable) => insert(makeChip(name, t, values), false);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      insert(document.createTextNode('\n'));
      return;
    }
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const { startContainer: at, startOffset: offset } = sel.getRangeAt(0);
    const back = event.key === 'Backspace';
    let neighbour: Node | null = null;
    if (at === box.current) {
      neighbour = at.childNodes[back ? offset - 1 : offset] ?? null;
    } else if (at.nodeType === Node.TEXT_NODE) {
      const text = (at.textContent ?? '').replaceAll(END, '');
      if (back && offset === 0) neighbour = at.previousSibling;
      if (!back && offset >= text.length) neighbour = at.nextSibling;
    }
    // A chip goes as a whole, never a letter at a time.
    if (isChip(neighbour)) {
      event.preventDefault();
      const before = neighbour.previousSibling;
      neighbour.remove();
      if (before) place(before);
      emit();
    }
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text) insert(document.createTextNode(text));
  };

  const over = maxLength !== undefined && value.length > maxLength;

  return (
    <div className="chip-editor">
      <div
        ref={box}
        id={id}
        className={`chip-editor-box${over ? ' is-over' : ''}`}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={over || undefined}
        contentEditable
        suppressContentEditableWarning
        dir="auto"
        tabIndex={0}
        style={{ minHeight: `${rows * 1.5}em` }}
        onInput={() => {
          emit();
          remember();
        }}
        onKeyDown={keyDown}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={remember}
        onPaste={paste}
        onDrop={(e) => e.preventDefault()}
      />
      <div className="chip-editor-bar">
        <Popover
          label={t('chips.insert')}
          icon={<Braces size={14} aria-hidden="true" />}
          showLabel
          align="left"
        >
          {(close) => (
            <ul className="menu" aria-label={t('chips.insert')}>
              {TEMPLATE_VARIABLES.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="menu-item chip-menu-item"
                    onClick={() => {
                      close();
                      insertVariable(name);
                    }}
                  >
                    <span className="chip-var chip-sample">{variableLabel(t, name)}</span>
                    {values && (
                      <span className="muted small" dir="auto">
                        {values[name]?.trim() || t('chips.missing')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
        {maxLength !== undefined && (
          <span className={`chip-count small${over ? ' is-over' : ' muted'}`} aria-live="polite">
            {over
              ? t('chips.tooLong', { max: maxLength })
              : t('chips.count', { count: value.length, max: maxLength })}
          </span>
        )}
      </div>
    </div>
  );
}
