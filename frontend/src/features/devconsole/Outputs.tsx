import type { DevClassifyOutput, DevDiscoverOutput, DevHistoryEntry } from '@lead-gen-crm/shared';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/shared/Toast.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { formatNumber, formatUsd } from '../../lib/format.js';

/** One click copies the text exactly as shown, and a toast says so. */
export function CopyText({ text, what }: { text: string; what: StringKey }) {
  const t = useT();
  const toast = useToast();
  const name = t(what);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(t('devc.copied', { what: name }));
    } catch {
      toast.show(t('devc.copy.failed'), 'error');
    }
  }
  return (
    <button
      type="button"
      className="button button-small button-icon-text"
      onClick={() => void copy()}
    >
      <Copy size={14} aria-hidden="true" />
      {name}
    </button>
  );
}

/** Read-only JSON, as it was sent or came back. */
export function JsonBox({
  value,
  label,
  copy,
}: {
  value: unknown;
  label: string;
  /** When given, a copy button sits above the box. */
  copy?: StringKey;
}) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="dc-jsonwrap">
      {copy && <CopyText text={text} what={copy} />}
      <pre className="dc-json" tabIndex={0} role="region" aria-label={label}>
        {text}
      </pre>
    </div>
  );
}

function RawToggle({ value }: { value: unknown }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="dc-raw">
      <button type="button" className="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('devc.raw.hide') : t('devc.raw.show')}
      </button>
      {open && <JsonBox value={value} label={t('devc.raw.label')} copy="devc.copy.raw" />}
    </div>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="dc-facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DiscoverOutputView({
  output,
  onUseInClassify,
}: {
  output: DevDiscoverOutput;
  onUseInClassify: () => void;
}) {
  const t = useT();
  const c = output.counts;
  return (
    <div className="dc-output">
      <Facts
        items={[
          [t('devc.out.returned'), formatNumber(c.returned)],
          [t('devc.out.new'), formatNumber(c.new)],
          [t('devc.out.outside'), formatNumber(c.outsideRegion)],
          [t('devc.out.known'), formatNumber(c.alreadyKnown)],
          [t('devc.out.noContact'), formatNumber(c.noContact)],
          [t('devc.out.duration'), seconds(output.durationMs)],
        ]}
      />
      {output.notice && (
        <p className="notice" role="status">
          {output.notice}
        </p>
      )}
      {output.skippedWords.length > 0 && (
        <p className="muted small">
          {t('devc.out.skipped', { words: output.skippedWords.join(', ') })}
        </p>
      )}

      <h3 className="dc-h">{t('devc.out.searches')}</h3>
      <table className="table dc-table">
        <thead>
          <tr>
            <th scope="col">{t('devc.out.word')}</th>
            <th scope="col" className="num">
              {t('devc.out.returned')}
            </th>
            <th scope="col" className="num">
              {t('devc.out.cost')}
            </th>
            <th scope="col">{t('devc.out.apify')}</th>
          </tr>
        </thead>
        <tbody>
          {output.searches.map((s) => (
            <tr key={s.word}>
              <th scope="row">{s.word}</th>
              <td className="num">{formatNumber(s.returned)}</td>
              <td className="num">{formatUsd(s.costUsd)}</td>
              <td>
                {s.apifyRunUrl ? (
                  <a href={s.apifyRunUrl} target="_blank" rel="noreferrer noopener">
                    {s.status}
                  </a>
                ) : (
                  s.status
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="dc-h">{t('devc.out.places')}</h3>
      {output.places.length === 0 ? (
        <p className="muted">{t('devc.out.noPlaces')}</p>
      ) : (
        <>
          <table className="table dc-table">
            <thead>
              <tr>
                <th scope="col">{t('devc.out.name')}</th>
                <th scope="col">{t('devc.out.category')}</th>
                <th scope="col">{t('devc.out.address')}</th>
                <th scope="col">{t('devc.out.phone')}</th>
                <th scope="col">{t('devc.out.website')}</th>
                <th scope="col">{t('devc.out.latlng')}</th>
                <th scope="col">{t('devc.out.flags')}</th>
              </tr>
            </thead>
            <tbody>
              {output.places.map((p, i) => (
                <tr key={`${p.name}-${p.word}-${i}`}>
                  <th scope="row">{p.name}</th>
                  <td>{p.category ?? '–'}</td>
                  <td>{p.address ?? '–'}</td>
                  <td>{p.phone ?? '–'}</td>
                  <td>{p.website ?? '–'}</td>
                  <td>
                    {p.lat !== null && p.lng !== null
                      ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
                      : '–'}
                  </td>
                  <td>
                    {[
                      p.outsideRegion ? t('devc.flag.outside') : null,
                      p.alreadyKnown ? t('devc.flag.known') : null,
                      p.noContact ? t('devc.flag.noContact') : null,
                    ]
                      .filter(Boolean)
                      .join(', ') || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="button" onClick={onUseInClassify}>
            {t('devc.out.useInClassify')}
          </button>
        </>
      )}

      <h3 className="dc-h">{t('devc.out.sent')}</h3>
      <JsonBox value={output.requests} label={t('devc.out.sent')} copy="devc.copy.sent" />
      <RawToggle value={output} />
    </div>
  );
}

export function ClassifyOutputView({ output }: { output: DevClassifyOutput }) {
  const t = useT();
  return (
    <div className="dc-output">
      <Facts
        items={[
          [t('devc.out.labelled'), formatNumber(output.rows.length)],
          [t('devc.out.duration'), seconds(output.durationMs)],
        ]}
      />
      {output.notice && (
        <p className="notice" role="status">
          {output.notice}
        </p>
      )}
      <table className="table dc-table">
        <thead>
          <tr>
            <th scope="col">{t('devc.out.name')}</th>
            <th scope="col">{t('devc.out.role')}</th>
            <th scope="col">{t('devc.out.evidence')}</th>
            <th scope="col">{t('devc.out.model')}</th>
            <th scope="col" className="num">
              {t('devc.out.cost')}
            </th>
          </tr>
        </thead>
        <tbody>
          {output.rows.map((r, i) => (
            <tr key={`${r.name}-${i}`}>
              <th scope="row">{r.name}</th>
              <td>{r.failed ? t('devc.out.failed') : (r.tradeRole ?? '–')}</td>
              <td>{r.evidence || '–'}</td>
              <td>{r.model ?? '–'}</td>
              <td className="num">{formatUsd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="dc-h">{t('devc.out.question')}</h3>
      <pre className="dc-json dc-question" tabIndex={0}>
        {output.system}
      </pre>
      <RawToggle value={output} />
    </div>
  );
}

/** What a finished (or failed) call shows: the header line, any error, then its step's view. */
export function EntryView({
  entry,
  onUseInClassify,
}: {
  entry: DevHistoryEntry;
  onUseInClassify: () => void;
}) {
  const t = useT();
  return (
    <div>
      <div className="dc-copybar">
        <CopyText text={JSON.stringify(entry.input, null, 2)} what="devc.copy.input" />
        <CopyText
          text={JSON.stringify(
            entry.error ? { error: entry.error, output: entry.output } : entry.output,
            null,
            2,
          )}
          what="devc.copy.output"
        />
      </div>
      <p className="dc-entry-head">
        <strong>{t(`devc.status.${entry.status}` as const)}</strong>
        {' · '}
        {new Date(entry.createdAt).toLocaleString()}
        {' · '}
        {formatUsd(entry.costUsd)}
        {' · '}
        {entry.by}
      </p>
      {entry.error && (
        <p className="form-error" role="alert">
          {entry.error}
        </p>
      )}
      {entry.output === null ? null : entry.step === 'discover' ? (
        <DiscoverOutputView
          output={entry.output as DevDiscoverOutput}
          onUseInClassify={onUseInClassify}
        />
      ) : (
        <ClassifyOutputView output={entry.output as DevClassifyOutput} />
      )}
    </div>
  );
}
