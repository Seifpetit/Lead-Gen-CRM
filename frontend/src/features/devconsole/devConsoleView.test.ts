import type { DevDiscoverOutput, DevOptions } from '@lead-gen-crm/shared';
import { DEV_LIMITS } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import {
  addWord,
  classifyFormFrom,
  classifyRequest,
  defaultClassify,
  defaultDiscover,
  discoverFormFrom,
  discoverRequest,
  rowsFromPlaces,
  type DiscoverForm,
} from './devConsoleView.js';

const options: DevOptions = {
  countries: [
    { code: 'TN', name: 'Tunisia', languages: ['fr', 'en'] },
    { code: 'FR', name: 'France', languages: ['fr'] },
  ],
  areas: [
    {
      regionId: 'sfax',
      name: 'Sfax',
      country: 'TN',
      bounds: { south: 34.6, west: 10.5, north: 34.9, east: 10.9 },
      cells: [{ cellKey: 'r0c0', south: 34.6, west: 10.5, north: 34.9, east: 10.7 }],
    },
    { regionId: 'fr-bretagne', name: 'Bretagne', country: 'FR', bounds: null, cells: [] },
  ],
  classifierConfigured: true,
  classifierModel: 'claude-haiku-5-5',
  limits: DEV_LIMITS,
};

const filled = (over: Partial<DiscoverForm> = {}): DiscoverForm => ({
  ...defaultDiscover(options, 'TN'),
  words: ['importateur'],
  ...over,
});

describe('discoverRequest', () => {
  it('starts on the first cell, with 5 places and the largest cap', () => {
    const form = defaultDiscover(options, 'TN');
    expect(form).toMatchObject({
      areaKind: 'cell',
      regionId: 'sfax',
      cellKey: 'r0c0',
      maxPlaces: '5',
      capUsd: '1.00',
      language: 'fr',
    });
  });

  it('falls back to the whole region when a country has no cells', () => {
    expect(defaultDiscover(options, 'FR')).toMatchObject({
      areaKind: 'region',
      regionId: 'fr-bretagne',
    });
  });

  it('builds the request for a cell', () => {
    expect(discoverRequest(filled())).toEqual({
      input: {
        country: 'TN',
        language: 'fr',
        words: ['importateur'],
        area: { kind: 'cell', regionId: 'sfax', cellKey: 'r0c0' },
        maxPlaces: 5,
        capUsd: 1,
      },
    });
  });

  it.each([
    ['no words', { words: [] }, 'words'],
    ['six words', { words: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'words'],
    ['21 places', { maxPlaces: '21' }, 'places'],
    ['half a place', { maxPlaces: '2.5' }, 'places'],
    ['a cap under the Apify minimum', { capUsd: '0.25' }, 'cap'],
    ['a cap over $1', { capUsd: '1.5' }, 'cap'],
    ['a cell with no key', { cellKey: '' }, 'cell'],
    ['no region', { areaKind: 'region', regionId: '' }, 'region'],
    ['an empty rectangle', { areaKind: 'rect' }, 'rect'],
  ] as const)('refuses %s', (_name, over, problem) => {
    expect(discoverRequest(filled(over as Partial<DiscoverForm>))).toEqual({ problem });
  });

  it('reads a rectangle with decimal commas and refuses one turned upside down', () => {
    const rect = { south: '34,6', west: '10.5', north: '34.9', east: '10.9' };
    expect(discoverRequest(filled({ areaKind: 'rect', rect }))).toMatchObject({
      input: { area: { kind: 'rect', south: 34.6, west: 10.5, north: 34.9, east: 10.9 } },
    });
    expect(
      discoverRequest(filled({ areaKind: 'rect', rect: { ...rect, south: '35', north: '34' } })),
    ).toEqual({ problem: 'rect' });
  });

  it('puts a past call back in the form unchanged', () => {
    const request = discoverRequest(filled());
    if (!('input' in request)) throw new Error('expected an input');
    expect(discoverRequest(discoverFormFrom(request.input))).toEqual(request);
  });
});

describe('addWord', () => {
  it('tidies a word and refuses blanks, repeats and a sixth', () => {
    expect(addWord([], '  épicerie   tunisienne ')).toEqual(['épicerie tunisienne']);
    expect(addWord([], '   ')).toBeNull();
    expect(addWord(['Import'], 'import')).toBeNull();
    expect(addWord(['a', 'b', 'c', 'd', 'e'], 'f')).toBeNull();
    expect(addWord([], 'x'.repeat(81))).toBeNull();
  });
});

describe('classifyRequest', () => {
  it('ignores a blank row and trims the rest', () => {
    const form = {
      ...defaultClassify('TN'),
      rows: [
        { name: ' Huile SA ', category: 'Huilerie', website: '', text: '' },
        { name: '', category: '', website: '', text: '' },
      ],
    };
    expect(classifyRequest(form)).toEqual({
      input: {
        country: 'TN',
        capUsd: 0.1,
        companies: [{ name: 'Huile SA', category: 'Huilerie' }],
      },
    });
  });

  it.each([
    ['nothing', [{ name: '', category: '', website: '', text: '' }], 'companies'],
    ['a row with no name', [{ name: '', category: 'Huilerie', website: '', text: '' }], 'name'],
  ] as const)('refuses %s', (_n, rows, problem) => {
    expect(classifyRequest({ ...defaultClassify('TN'), rows: [...rows] })).toEqual({ problem });
  });

  it('refuses 21 companies and a cap over $0.50', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      name: `C${i}`,
      category: '',
      website: '',
      text: '',
    }));
    expect(classifyRequest({ ...defaultClassify('TN'), rows })).toEqual({ problem: 'companies' });
    expect(classifyRequest({ ...defaultClassify('TN'), capUsd: '0.51' })).toEqual({
      problem: 'companies',
    });
    expect(
      classifyRequest({
        ...defaultClassify('TN'),
        capUsd: '0.51',
        rows: [{ name: 'A', category: '', website: '', text: '' }],
      }),
    ).toEqual({ problem: 'cap' });
  });

  it('round-trips through a past call', () => {
    const request = classifyRequest({
      ...defaultClassify('FR'),
      rows: [{ name: 'A', category: 'c', website: 'w', text: 't' }],
    });
    if (!('input' in request)) throw new Error('expected an input');
    expect(classifyRequest(classifyFormFrom(request.input))).toEqual(request);
  });
});

describe('rowsFromPlaces', () => {
  const place = (name: string, address: string) => ({
    name,
    category: 'Huilerie',
    address,
    phone: null,
    website: 'https://x.example',
    lat: null,
    lng: null,
    word: 'huile',
    outsideRegion: null,
    alreadyKnown: false,
    noContact: false,
  });
  it('makes one row per distinct place, at most 20', () => {
    const output = {
      places: [
        place('A', 'rue 1'),
        place('A', 'rue 1'),
        ...Array.from({ length: 30 }, (_, i) => place(`P${i}`, 'rue')),
      ],
    } as unknown as DevDiscoverOutput;
    const rows = rowsFromPlaces(output);
    expect(rows).toHaveLength(20);
    expect(rows[0]).toEqual({
      name: 'A',
      category: 'Huilerie',
      website: 'https://x.example',
      text: '',
    });
  });
});
