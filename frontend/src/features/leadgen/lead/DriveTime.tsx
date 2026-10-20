import { Car, SquareArrowOutUpRight } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '../../../i18n/index.js';
import {
  driveBetween,
  formatDriveTime,
  geocodeAddress,
  googleDirectionsLink,
  loadMyAddress,
  saveMyAddress,
  type Drive,
  type MyAddress,
  type Point,
} from '../../../lib/driveTime.js';
import { formatNumber } from '../../../lib/format.js';

type State =
  | { step: 'idle' }
  | { step: 'asking' }
  | { step: 'working' }
  | { step: 'done'; drive: Drive }
  | { step: 'problem'; message: 'notFound' | 'noRoute' | 'unreachable' };

/**
 * "Add your address to see how long it takes by car": the person types where they start from,
 * the address is found and the road route measured when they press the button, and the answer
 * stays on the card. The address is kept in this browser only, so the next lead shows its drive
 * time straight away. Without an answer the same trip is one click away in Google Maps.
 */
export function DriveTime({ to }: { to: Point }) {
  const t = useT();
  const [mine, setMine] = useState<MyAddress | null>(loadMyAddress);
  const [text, setText] = useState(mine?.text ?? '');
  const [state, setState] = useState<State>(() => (mine ? { step: 'working' } : { step: 'idle' }));

  // A saved address measures this business as soon as the card opens.
  useEffect(() => {
    if (!mine) return;
    let cancelled = false;
    setState({ step: 'working' });
    driveBetween(mine, to)
      .then((drive) => {
        if (!cancelled)
          setState(drive ? { step: 'done', drive } : { step: 'problem', message: 'noRoute' });
      })
      .catch(() => {
        if (!cancelled) setState({ step: 'problem', message: 'unreachable' });
      });
    return () => {
      cancelled = true;
    };
  }, [mine, to]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const typed = text.trim();
    if (typed === '') return;
    setState({ step: 'working' });
    try {
      const found = await geocodeAddress(typed);
      if (!found) {
        setState({ step: 'problem', message: 'notFound' });
        return;
      }
      const next = { text: typed, ...found };
      saveMyAddress(next);
      setMine(next);
    } catch {
      setState({ step: 'problem', message: 'unreachable' });
    }
  }

  const form = (
    <form className="drive-form" onSubmit={(e) => void submit(e)}>
      <label className="visually-hidden" htmlFor="drive-address">
        {t('drive.address')}
      </label>
      <input
        id="drive-address"
        className="input"
        value={text}
        placeholder={t('drive.placeholder')}
        autoComplete="street-address"
        data-autofocus
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="button button-primary" disabled={text.trim() === ''}>
        {t('drive.calculate')}
      </button>
    </form>
  );

  return (
    <div className="drive" aria-live="polite">
      {state.step === 'idle' && (
        <button
          type="button"
          className="button button-icon-text"
          onClick={() => setState({ step: 'asking' })}
        >
          <Car size={14} aria-hidden="true" />
          {t('drive.add')}
        </button>
      )}
      {state.step === 'asking' && form}
      {state.step === 'working' && <p className="muted">{t('drive.working')}</p>}
      {state.step === 'done' && mine && (
        <p className="drive-result">
          <Car size={14} aria-hidden="true" />
          <span>
            {t('drive.result', {
              time: formatDriveTime(state.drive.minutes),
              km: formatNumber(state.drive.km, 0),
              from: mine.text,
            })}
          </span>
          <button
            type="button"
            className="button-link"
            onClick={() => setState({ step: 'asking' })}
          >
            {t('drive.change')}
          </button>
        </p>
      )}
      {state.step === 'problem' && (
        <>
          <p className="form-error" role="alert">
            {t(`drive.problem.${state.message}`)}
          </p>
          {form}
          {text.trim() !== '' && (
            <a
              className="location-open"
              href={googleDirectionsLink(text.trim(), to)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('drive.google')}
              <SquareArrowOutUpRight size={12} aria-hidden="true" />
            </a>
          )}
        </>
      )}
    </div>
  );
}
