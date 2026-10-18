import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeServer } from '../../test/fakeServer.js';
import { company, evidence, lead } from '../../test/fixtures.js';
import { renderWith } from '../../test/render.js';
import { LeadCard } from '../crm/LeadCard.js';
import { mapsSourceUrl } from '../../lib/lead.js';
import { LeadDetailCard } from './LeadDetailCard.js';

const MAPS = 'https://maps.example.test/place/1';
const reasons = [
  {
    component: 'companyFit' as const,
    points: 20,
    reason: 'qualified by rules',
    kind: 'fact' as const,
    evidence: [],
  },
  {
    component: 'reachability' as const,
    points: -2,
    reason: '1 lead(s) in sector textile were dismissed',
    kind: 'estimate' as const,
    evidence: [],
  },
];

describe('score reasons and the Google Maps source', () => {
  it('lists each stored score reason on the lead detail', () => {
    renderWith(
      <LeadDetailCard lead={lead({ scoreReasons: reasons })} onMoved={() => {}} />,
      fakeServer({}),
    );
    expect(screen.getByText(/\+20 points: qualified by rules/)).toBeTruthy();
    expect(
      screen.getByText(/-2 points: 1 lead\(s\) in sector textile were dismissed/),
    ).toBeTruthy();
  });

  it('says so when no reasons were stored', () => {
    renderWith(<LeadDetailCard lead={lead()} onMoved={() => {}} />, fakeServer({}));
    expect(screen.getByText('No per-point reasons were stored for this lead.')).toBeTruthy();
  });

  it('links the Google Maps place page as the source, on the detail and the CRM card', () => {
    const l = lead();
    const { unmount } = renderWith(<LeadDetailCard lead={l} onMoved={() => {}} />, fakeServer({}));
    expect(screen.getByRole('link', { name: 'Google Maps place' }).getAttribute('href')).toBe(MAPS);
    unmount();
    renderWith(
      <ul>
        <LeadCard lead={l} onMoved={() => {}} />
      </ul>,
      fakeServer({}),
    );
    const card = screen.getByRole('listitem');
    expect(within(card).getByRole('link', { name: 'Google Maps place' }).getAttribute('href')).toBe(
      MAPS,
    );
  });

  it('shows no source link when nothing cites a Maps page, and ignores unsafe URLs', () => {
    expect(mapsSourceUrl(company({ evidence: [] }))).toBeNull();
    expect(
      mapsSourceUrl(
        company({ evidence: [evidence('placeId', 'place-1', 'fact', 'javascript:alert(1)')] }),
      ),
    ).toBeNull();
    expect(mapsSourceUrl(company())).toBe(MAPS);
  });
});
