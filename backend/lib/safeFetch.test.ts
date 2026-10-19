import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedUrlError, checkUrl, fetchPage, isBlockedAddress } from './safeFetch.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.5.5.5',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.0.2.5',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.1.2.3',
    '::ffff:7f00:1',
    '::10.0.0.1',
    '2001:db8::1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '41.226.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows the public address %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('checkUrl', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'javascript:alert(1)',
    'gopher://example.com',
    'http://localhost/',
    'http://LOCALHOST:3000/',
    'http://app.localhost/',
    'http://printer.local/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://10.0.0.1:8080/admin',
    'http://192.168.0.10/',
    'http://169.254.169.254/latest/meta-data/',
    'http://user:pass@example.com/',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => checkUrl(url)).toThrow(BlockedUrlError);
  });

  it('accepts a public http or https address', () => {
    expect(checkUrl('https://www.example.tn/a').hostname).toBe('www.example.tn');
    expect(checkUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
  });
});

describe('fetchPage', () => {
  let server: http.Server;
  let base: string;
  const big = 'x'.repeat(2_000_000);
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return void res.end('<meta property="og:image" content="/a.jpg">');
      }
      if (req.url === '/big') {
        res.setHeader('content-type', 'text/html');
        return void res.end(`<meta property="og:image" content="/a.jpg">${big}`);
      }
      if (req.url === '/slow') {
        res.setHeader('content-type', 'text/html');
        return void res.write('<html>'); // never finishes
      }
      if (req.url === '/json') {
        res.setHeader('content-type', 'application/json');
        return void res.end('{}');
      }
      if (req.url === '/hop') {
        res.statusCode = 302;
        res.setHeader('location', '/ok');
        return void res.end();
      }
      if (req.url === '/loop') {
        res.statusCode = 302;
        res.setHeader('location', '/loop');
        return void res.end();
      }
      if (req.url === '/to-private') {
        res.statusCode = 302;
        res.setHeader(
          'location',
          `http://private.test:${(server.address() as AddressInfo).port}/ok`,
        );
        return void res.end();
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://public.test:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // Names resolve to the local server; the "private" one is marked private by the test.
  const lookup = ((
    host: string,
    _o: unknown,
    cb: (e: null, a: { address: string; family: number }[]) => void,
  ) => {
    cb(null, [{ address: host === 'private.test' ? '10.9.9.9' : '127.0.0.1', family: 4 }]);
  }) as never;
  const options = { lookup, isBlocked: (ip: string) => ip === '10.9.9.9' };

  it('reads a page, following a redirect', async () => {
    expect((await fetchPage(`${base}/ok`, options)).html).toContain('og:image');
    const hopped = await fetchPage(`${base}/hop`, options);
    expect(hopped.url).toBe(`${base}/ok`);
  });

  it('stops reading at the size limit instead of downloading everything', async () => {
    const page = await fetchPage(`${base}/big`, { ...options, maxBytes: 1_000_000 });
    expect(page.html.length).toBeLessThanOrEqual(1_000_000);
    expect(page.html).toContain('og:image');
  });

  it('gives up after the timeout', async () => {
    await expect(fetchPage(`${base}/slow`, { ...options, timeoutMs: 300 })).rejects.toThrow(
      /Timed out/,
    );
  });

  it('refuses answers that are not pages, redirect loops and 404s', async () => {
    await expect(fetchPage(`${base}/json`, options)).rejects.toThrow(/Not a page/);
    await expect(fetchPage(`${base}/loop`, options)).rejects.toThrow(/Too many redirects/);
    await expect(fetchPage(`${base}/missing`, options)).rejects.toThrow(/Not a page/);
  });

  it('refuses a name that resolves to a private address', async () => {
    await expect(
      fetchPage(`http://private.test:${(server.address() as AddressInfo).port}/ok`, options),
    ).rejects.toThrow(BlockedUrlError);
  });

  it('refuses a redirect into a private address', async () => {
    await expect(fetchPage(`${base}/to-private`, options)).rejects.toThrow(BlockedUrlError);
  });

  it('never even connects to a literal private address', async () => {
    await expect(fetchPage('http://127.0.0.1:1/', {})).rejects.toThrow(BlockedUrlError);
    await expect(fetchPage('http://169.254.169.254/', {})).rejects.toThrow(BlockedUrlError);
  });
});
