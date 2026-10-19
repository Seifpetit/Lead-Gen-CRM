import { describe, expect, it } from 'vitest';
import { parsePageImage } from './pageImage.js';

const PAGE = 'https://www.huilerie.tn/accueil/';
const page = (head: string) => `<html><head><title>x</title>${head}</head><body></body></html>`;

describe('parsePageImage', () => {
  it('prefers og:image over twitter:image', () => {
    const html = page(`
      <meta name="twitter:image" content="https://cdn.tn/t.jpg">
      <meta property="og:image" content="https://cdn.tn/o.jpg">`);
    expect(parsePageImage(html, PAGE)).toBe('https://cdn.tn/o.jpg');
  });

  it('falls back to twitter:image, and reads either attribute order and quote style', () => {
    expect(
      parsePageImage(page(`<meta content='https://cdn.tn/t.png' name='twitter:image'>`), PAGE),
    ).toBe('https://cdn.tn/t.png');
    expect(
      parsePageImage(page(`<META PROPERTY=og:image CONTENT=https://cdn.tn/u.png />`), PAGE),
    ).toBe('https://cdn.tn/u.png');
  });

  it('resolves relative addresses against the page and decodes entities', () => {
    expect(parsePageImage(page(`<meta property="og:image" content="/img/a.jpg">`), PAGE)).toBe(
      'https://www.huilerie.tn/img/a.jpg',
    );
    expect(
      parsePageImage(page(`<meta property="og:image" content="//cdn.tn/a.jpg?x=1&amp;y=2">`), PAGE),
    ).toBe('https://cdn.tn/a.jpg?x=1&y=2');
  });

  it('ignores anything that is not an http(s) address, and a page with no image', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x/a.jpg', '']) {
      expect(parsePageImage(page(`<meta property="og:image" content="${bad}">`), PAGE)).toBeNull();
    }
    expect(parsePageImage(page(`<meta property="og:title" content="Huilerie">`), PAGE)).toBeNull();
    expect(parsePageImage('', PAGE)).toBeNull();
  });

  it('skips an unusable first tag and uses the next good one', () => {
    const html = page(`
      <meta property="og:image" content="javascript:x">
      <meta property="twitter:image" content="https://cdn.tn/ok.jpg">`);
    expect(parsePageImage(html, PAGE)).toBe('https://cdn.tn/ok.jpg');
  });
});
