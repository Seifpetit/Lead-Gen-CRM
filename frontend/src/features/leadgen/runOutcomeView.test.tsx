import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { funnel, run } from '../../test/fixtures.js';
import { I18nProvider, useT } from '../../i18n/index.js';
import { OutcomeBadge, outcomeText } from './runOutcomeView.js';

function Sentence({ r, searches }: { r: ReturnType<typeof run>; searches?: number }) {
  const t = useT();
  return <p>{outcomeText(t, r, searches)}</p>;
}
const sentence = (r: ReturnType<typeof run>, searches?: number) => {
  const { container } = render(
    <I18nProvider>
      <Sentence r={r} {...(searches === undefined ? {} : { searches })} />
    </I18nProvider>,
  );
  return container.textContent;
};

const bizerte = run({
  region: 'bizerte',
  placesDroppedOutside: 98,
  funnel: funnel({
    discovered: 0,
    skipped: 0,
    qualified: 0,
    review: 0,
    unreachable: 0,
    peopleFound: 0,
    leads: 0,
  }),
});
const sfax = run({
  funnel: funnel({
    discovered: 30,
    skipped: 0,
    qualified: 7,
    review: 0,
    unreachable: 0,
    peopleFound: 0,
    leads: 0,
  }),
});

describe('run outcome words', () => {
  it('says what a run with leads came to', () => {
    expect(sentence(run({ funnel: funnel({ discovered: 30, skipped: 0, leads: 28 }) }))).toBe(
      '30 places found, 28 leads',
    );
  });

  it('puts the searches first when they are known', () => {
    expect(sentence(bizerte, 16)).toBe('16 searches, 98 places found, none inside Bizerte');
  });

  it('explains a run whose places all lay outside the region', () => {
    expect(sentence(bizerte)).toBe('98 places found, none inside Bizerte');
  });

  it('explains a run that had no companies to carry on with', () => {
    expect(sentence(sfax)).toBe(
      '7 kept, 0 people found, so the people step had nothing to carry forward',
    );
  });

  it('says so when the searches found nothing', () => {
    expect(
      sentence(
        run({
          funnel: funnel({
            discovered: 0,
            skipped: 0,
            qualified: 0,
            review: 0,
            unreachable: 0,
            peopleFound: 0,
            leads: 0,
          }),
        }),
      ),
    ).toBe('The searches returned no places');
  });

  it('says a run stopped by its cap in one clean sentence, never the raw message', () => {
    const capped = run({
      status: 'stopped_by_cap',
      error: 'Spend cap reached: 1 place found',
    });
    expect(sentence(capped, 7)).toBe('Spend cap reached after 7 searches');
    expect(sentence(capped, 1)).toBe('Spend cap reached after 1 search');
    expect(sentence(capped)).toBe('Spend cap reached');
  });

  it('badges each outcome with words, an icon and a colour, green only for leads', () => {
    const cases: [ReturnType<typeof run>, string, string][] = [
      [run(), 'Completed with leads', 'green'],
      [bizerte, 'Ended, no results', 'yellow'],
      [sfax, 'Ended early', 'yellow'],
      [run({ status: 'running' }), 'Running', 'blue'],
      [run({ status: 'stopped_by_cap' }), 'Stopped by spend cap', 'red'],
      [run({ status: 'failed', error: 'x' }), 'Failed', 'red'],
    ];
    for (const [r, label, tone] of cases) {
      const { unmount } = render(
        <I18nProvider>
          <OutcomeBadge run={r} />
        </I18nProvider>,
      );
      const badge = screen.getByText(label);
      expect(badge).toHaveAttribute('data-tone', tone);
      expect(badge.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });
});
