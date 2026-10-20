import { describe, expect, it } from 'vitest';
import { googleMapsUrl } from './exports.js';
import {
  DEFAULT_TEMPLATES,
  fillTemplate,
  joinTemplate,
  MAX_TEMPLATE_LENGTH,
  missingVariables,
  parseTemplate,
  whatsappNumber,
} from './messages.js';

describe('templates', () => {
  it('splits text and variables, leaving unknown braces as text', () => {
    const body = 'Bonjour {person}, {unknown} chez {company}.';
    expect(parseTemplate(body)).toEqual([
      { kind: 'text', text: 'Bonjour ' },
      { kind: 'variable', name: 'person' },
      { kind: 'text', text: ', {unknown} chez ' },
      { kind: 'variable', name: 'company' },
      { kind: 'text', text: '.' },
    ]);
    expect(joinTemplate(parseTemplate(body))).toBe(body);
  });

  it('fills a template as plain text and lists what is missing', () => {
    const values = { person: 'Amel', company: 'Huilerie Baccar', sector: '  ' };
    expect(fillTemplate('Bonjour {person} de {company} ({sector})', values)).toBe(
      'Bonjour Amel de Huilerie Baccar ()',
    );
    expect(missingVariables('{sector} {my_name} {sector}', values)).toEqual(['sector', 'my_name']);
    expect(fillTemplate('مرحبا {person}', values)).toBe('مرحبا Amel');
  });

  it('ships three French defaults that fit the limit', () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(3);
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body.length).toBeLessThanOrEqual(MAX_TEMPLATE_LENGTH);
      expect(t.body).toMatch(/Bonjour/);
    }
  });
});

describe('whatsappNumber', () => {
  it('accepts Tunisian mobiles in any common form', () => {
    expect(whatsappNumber('+216 98 123 456')).toBe('21698123456');
    expect(whatsappNumber('00216-55.123.456')).toBe('21655123456');
    expect(whatsappNumber('22 123 456')).toBe('21622123456');
    expect(whatsappNumber('(+216) 41123456')).toBe('21641123456');
  });

  it('refuses landlines, special numbers, foreign numbers and text', () => {
    for (const n of [
      '74 123 456',
      '+216 71 000 000',
      '80 100 200',
      '+33 6 12 34 56 78',
      'poste 12',
      '',
      null,
    ]) {
      expect(whatsappNumber(n), String(n)).toBeNull();
    }
  });
});

describe('googleMapsUrl', () => {
  it('points at the coordinates when known, else at the name and city', () => {
    expect(googleMapsUrl('X', { lat: 34.7, lng: 10.7 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=34.7%2C10.7',
    );
    expect(googleMapsUrl('Huilerie Baccar', null, 'Sfax')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Huilerie%20Baccar%2C%20Sfax',
    );
  });
});
