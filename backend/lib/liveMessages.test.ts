import { describe, expect, it } from 'vitest';
import { liveMessages, sectorList } from './liveMessages.js';

const f = { region: 'Ben Arous', sectors: ['Olive oil'], customOnly: false };

describe('sectorList', () => {
  it('joins one, two and three names, and counts more', () => {
    expect(sectorList(['Olive oil'])).toBe('olive oil');
    expect(sectorList(['Olive oil', 'Textile'])).toBe('olive oil and textile');
    expect(sectorList(['Olive oil', 'Textile', 'Steel'])).toBe('olive oil, textile and steel');
    expect(sectorList(['a', 'b', 'c', 'd'])).toBe('4 sectors');
    expect(sectorList([])).toBe('');
  });
});

describe('liveMessages', () => {
  it('says what is searched and where', () => {
    expect(liveMessages.searching(f)).toBe(
      'Searching Google Maps for olive oil companies in Ben Arous...',
    );
    expect(liveMessages.searching({ ...f, sectors: [] })).toBe(
      'Searching Google Maps for companies in Ben Arous...',
    );
    expect(liveMessages.searching({ ...f, sectors: [], customOnly: true })).toBe(
      'Searching Google Maps for your searches in Ben Arous...',
    );
  });

  it('reports progress with counts and the right plurals', () => {
    expect(liveMessages.searchingProgress({ ...f, done: 3, total: 12, found: 1 })).toBe(
      'Searching Google Maps for olive oil companies in Ben Arous... 3 of 12 searches done, 1 company found so far.',
    );
    expect(liveMessages.checking({ found: 24 })).toBe(
      'Found 24 companies, checking which ones move goods...',
    );
    expect(liveMessages.checking({ found: 1 })).toBe(
      'Found 1 company, checking which ones move goods...',
    );
    expect(liveMessages.people({ qualified: 9 })).toContain('Looking up the people who work there');
    expect(liveMessages.peopleProgress({ done: 2, total: 9 })).toBe(
      'Looking up the people who work there... 2 of 9 companies done.',
    );
    expect(liveMessages.emails({ count: 12 })).toBe('Verifying 12 email addresses...');
    expect(liveMessages.emails({ count: 1 })).toBe('Verifying 1 email address...');
    expect(liveMessages.scoring({ companies: 6 })).toBe('Scoring and ranking 6 companies...');
  });

  it('says how it ended', () => {
    expect(liveMessages.done({ leads: 11 })).toBe('Done. 11 leads are ready.');
    expect(liveMessages.done({ leads: 1 })).toBe('Done. 1 lead is ready.');
    expect(liveMessages.done({ leads: 0 })).toBe('Done. No leads this time.');
    expect(liveMessages.stopped({ leads: 3 })).toBe('Stopped. 3 leads were kept.');
    expect(liveMessages.cappedOut({ leads: 1 })).toContain('spend cap');
    expect(liveMessages.failed({ reason: 'No free cells to search in this region' })).toBe(
      'This run could not finish: No free cells to search in this region',
    );
    expect(liveMessages.failed({})).toBe('This run could not finish.');
  });

  it('never uses the internal step names', () => {
    const all = [
      liveMessages.searching(f),
      liveMessages.checking({ found: 5 }),
      liveMessages.people({ qualified: 5 }),
      liveMessages.contacts({ people: 5 }),
      liveMessages.verifying({ companies: 5 }),
      liveMessages.scoring({ companies: 5 }),
      liveMessages.done({ leads: 5 }),
    ].join(' ');
    for (const word of ['Discover', 'Enriched', 'Unreachable', 'find_people', 'qualify']) {
      expect(all).not.toContain(word);
    }
  });
});
