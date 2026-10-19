import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

// Fetches one public web page for the server, safely: http and https only, never an address
// on a private or local network (checked again after every redirect and at connect time, so a
// name that changes its answer cannot slip through), a small time and size budget, and no
// script execution. It returns text; it never loads anything the page refers to.

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

function v4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
}

/** True for any address that is not a normal public internet address. */
export function isBlockedAddress(address: string): boolean {
  const ip = address
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!
    .toLowerCase();
  const kind = isIP(ip);
  if (kind === 0) return true;
  if (kind === 4) {
    const [a, b] = v4Parts(ip)!;
    return (
      a === 0 || // "this" network
      a === 10 ||
      a === 127 || // loopback
      (a === 100 && b! >= 64 && b! <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, including cloud metadata
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 0) || // protocol assignments and documentation
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a! >= 224 // multicast and reserved
    );
  }
  // IPv6
  if (ip === '::' || ip === '::1') return true;
  // IPv4 inside IPv6 (::ffff:1.2.3.4, ::ffff:0102:0304): judge the IPv4 address.
  const mapped = ip.match(/^(?:0{0,4}:){0,5}ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1]!;
    if (rest.includes('.')) return isBlockedAddress(rest);
    const hex = rest.split(':').map((h) => parseInt(h, 16));
    if (hex.length === 2 && hex.every((n) => Number.isInteger(n))) {
      return isBlockedAddress(`${hex[0]! >> 8}.${hex[0]! & 255}.${hex[1]! >> 8}.${hex[1]! & 255}`);
    }
    return true;
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (
    first === 0 || // ::/8, including IPv4-compatible forms like ::10.0.0.1
    (first & 0xfe00) === 0xfc00 || // unique local
    (first & 0xffc0) === 0xfe80 || // link-local
    (first & 0xff00) === 0xff00 || // multicast
    ip.startsWith('2001:db8:') // documentation
  );
}

type LookupFn = (
  hostname: string,
  options: { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export interface PageFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Tests only: replaces the real name lookup. */
  lookup?: LookupFn;
  /** Tests only: replaces the private-address check (a local test server is on loopback). */
  isBlocked?: (address: string) => boolean;
}

export interface FetchedPage {
  /** The address the text came from, after redirects. */
  url: string;
  html: string;
}

const DEFAULTS = { timeoutMs: 5_000, maxBytes: 1_000_000, maxRedirects: 3 };

/** Parses and screens an address before anything is requested. */
export function checkUrl(raw: string, isBlocked = isBlockedAddress): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Not a valid address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http and https addresses are allowed');
  }
  if (url.username || url.password) throw new BlockedUrlError('Addresses with logins are refused');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new BlockedUrlError('Local names are refused');
  }
  if (isIP(host) && isBlocked(host)) throw new BlockedUrlError('Private addresses are refused');
  return url;
}

/**
 * Reads up to maxBytes of a page. Rejects with BlockedUrlError for a refused address, and with
 * an ordinary Error for a timeout, a non-page answer or a network failure.
 */
export async function fetchPage(raw: string, options: PageFetchOptions = {}): Promise<FetchedPage> {
  const { timeoutMs, maxBytes, maxRedirects } = { ...DEFAULTS, ...options };
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const realLookup = (options.lookup ?? (dnsLookup as unknown as LookupFn)) as LookupFn;
  const deadline = Date.now() + timeoutMs;

  // The connection uses only an address that passed the check, so what was checked is what is
  // connected to.
  const guardedLookup = ((
    hostname: string,
    opts: { all?: boolean },
    callback: (err: Error | null, address?: string | LookupAddress[], family?: number) => void,
  ) => {
    realLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (addresses.length === 0 || addresses.some((a) => isBlocked(a.address))) {
        return callback(new BlockedUrlError('Resolves to a private address'));
      }
      if (opts.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  }) as never;

  let current = checkUrl(raw, isBlocked);
  for (let hop = 0; ; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('Timed out');
    const answer = await requestOnce(current, left, maxBytes, guardedLookup);
    if (answer.redirect) {
      if (hop >= maxRedirects) throw new Error('Too many redirects');
      current = checkUrl(new URL(answer.redirect, current).toString(), isBlocked);
      continue;
    }
    return { url: current.toString(), html: answer.html };
  }
}

function requestOnce(
  url: URL,
  timeoutMs: number,
  maxBytes: number,
  lookup: never,
): Promise<{ redirect: string | null; html: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup,
        headers: {
          // Plain text only: no compressed body that expands past the size limit.
          'accept-encoding': 'identity',
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'Mozilla/5.0 (compatible; LeadGenCRM/1.0; link preview)',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: res.headers.location, html: '' });
        }
        const type = String(res.headers['content-type'] ?? '');
        if (status < 200 || status >= 300 || !/html/i.test(type)) {
          res.resume();
          return reject(new Error(`Not a page (status ${status})`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // The head of the page is enough: stop reading at the limit.
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () =>
          resolve({ redirect: null, html: Buffer.concat(chunks).toString('utf8') });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', () => finish());
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timed out')));
    const hard = setTimeout(() => req.destroy(new Error('Timed out')), timeoutMs);
    req.on('close', () => clearTimeout(hard));
    req.on('error', reject);
    req.end();
  });
}
