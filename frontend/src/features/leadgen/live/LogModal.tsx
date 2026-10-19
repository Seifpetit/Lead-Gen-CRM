import type { RunSummary } from '@lead-gen-crm/shared';
import { ArrowDownToLine, Copy, Download } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Modal } from '../../../components/Modal.js';
import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { isActive } from '../runParts.js';
import {
  filterLog,
  logFileName,
  logLineText,
  logTime,
  logToText,
  type LevelFilter,
} from './logText.js';
import { useRunLog } from './useRunLog.js';
import './live.css';

/** Height of one line; every line is one row so only the visible ones have to be drawn. */
export const ROW_PX = 20;
const OVERSCAN = 12;
/** Height assumed before the panel has been measured (and where nothing can be measured). */
const FALLBACK_VIEW_PX = 600;
/** How close to the end counts as "at the end". */
const BOTTOM_SLACK_PX = ROW_PX;

/** Puts text on the clipboard; falls back to a hidden text box where the clipboard API is missing. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  box.remove();
  return ok;
}

function download(name: string, text: string): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

/**
 * Every line of a run's log in a terminal-style window: monospace on a dark panel (the one dark
 * place in the light theme), the time and level of each line, technical detail dimmed. New lines
 * arrive at the bottom and the view follows them; scrolling up pauses that until "Jump to
 * latest". Only the lines on screen are drawn, so a long log stays quick.
 */
export function LogModal({ run, onClose }: { run: RunSummary; onClose: () => void }) {
  const t = useT();
  const active = isActive(run.status);
  const log = useRunLog(run.id, active);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const shown = useMemo(() => filterLog(log.lines, level, query), [log.lines, level, query]);

  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const [view, setView] = useState({ top: 0, height: FALLBACK_VIEW_PX });
  const total = shown.length * ROW_PX;

  // Where the last scroll we did ourselves ended. A scroll event that lands there is ours (new
  // lines may already have made the log longer by the time it fires), not the person leaving.
  const ownTop = useRef<number | null>(null);
  const scrollToEnd = useCallback((el: HTMLElement, to: number) => {
    el.scrollTop = to;
    ownTop.current = el.scrollTop;
    setView({ top: el.scrollTop, height: el.clientHeight || FALLBACK_VIEW_PX });
  }, []);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const height = el.clientHeight || FALLBACK_VIEW_PX;
    setView((v) =>
      v.top === el.scrollTop && v.height === height ? v : { top: el.scrollTop, height },
    );
    if (ownTop.current !== null && Math.abs(el.scrollTop - ownTop.current) < 1) return;
    const atEnd = ROW_PX * shown.length - el.scrollTop - height <= BOTTOM_SLACK_PX;
    followRef.current = atEnd;
    setFollow(atEnd);
  }, [shown.length]);

  // Keep the view on the newest line while following; a new line never moves a paused view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !followRef.current) return;
    scrollToEnd(el, total);
  }, [total, scrollToEnd]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  function jumpToLatest() {
    const el = scroller.current;
    followRef.current = true;
    setFollow(true);
    if (el) scrollToEnd(el, total);
  }

  const first = Math.max(0, Math.floor(view.top / ROW_PX) - OVERSCAN);
  const last = Math.min(shown.length, Math.ceil((view.top + view.height) / ROW_PX) + OVERSCAN);
  const rows = shown.slice(first, last);

  async function copy() {
    setNote((await copyText(logToText(shown))) ? t('logs.copied') : t('logs.copyFailed'));
  }
  function save() {
    if (!download(logFileName(run.region), logToText(shown))) setNote(t('logs.copyFailed'));
  }

  const empty = !log.loading && log.lines.length === 0;
  return (
    <Modal title={t('logs.title', { region: run.region })} onClose={onClose} full>
      <div className="log-modal">
        <div className="log-tools">
          <ToggleGroup<LevelFilter>
            label={t('logs.level')}
            value={level}
            onChange={setLevel}
            options={[
              { value: 'all', label: t('logs.level.all') },
              { value: 'warn', label: t('logs.level.warn') },
              { value: 'error', label: t('logs.level.error') },
            ]}
          />
          <label className="log-search">
            <span className="visually-hidden">{t('logs.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('logs.search.placeholder')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="log-count muted">
            {t('logs.lines', { shown: shown.length, total: log.lines.length })}
          </span>
          <span className="log-buttons">
            <button type="button" className="button button-icon-text" onClick={() => void copy()}>
              <Copy size={14} aria-hidden="true" />
              {t('logs.copy')}
            </button>
            <button type="button" className="button button-icon-text" onClick={save}>
              <Download size={14} aria-hidden="true" />
              {t('logs.download')}
            </button>
          </span>
          <span className="visually-hidden" role="status">
            {note}
          </span>
        </div>

        <div className="log-stage">
          <div
            ref={scroller}
            className="term"
            role="log"
            aria-live="off"
            aria-label={t('logs.panel')}
            tabIndex={0}
            onScroll={measure}
          >
            {log.error !== null && log.lines.length === 0 ? (
              <p className="term-note" role="alert">
                {describeError(t, log.error)}
              </p>
            ) : log.loading ? (
              <p className="term-note">{t('logs.loading')}</p>
            ) : empty ? (
              <p className="term-note">{t('logs.empty')}</p>
            ) : shown.length === 0 ? (
              <p className="term-note">{t('logs.noMatch')}</p>
            ) : (
              <div className="term-lines" style={{ height: total }}>
                {rows.map((line, i) => (
                  <div
                    key={line.id}
                    className="term-row"
                    data-level={line.level}
                    data-technical={line.technical ? 'true' : undefined}
                    title={logLineText(line)}
                    style={{ top: (first + i) * ROW_PX } as CSSProperties}
                  >
                    <span className="term-time">{logTime(line.at)}</span>
                    <span className="term-level">{line.level.toUpperCase()}</span>
                    <span className="term-msg">{line.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!follow && shown.length > 0 && (
            <button type="button" className="button button-primary jump" onClick={jumpToLatest}>
              <ArrowDownToLine size={14} aria-hidden="true" />
              {t('logs.jump')}
            </button>
          )}
        </div>

        <p className="log-foot muted">
          {!active && !log.loading ? t('logs.ended') : follow ? t('logs.live') : t('logs.paused')}
        </p>
      </div>
    </Modal>
  );
}
