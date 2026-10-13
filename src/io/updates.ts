// The update feed (Settings ▸ Updates): one request to GitHub for the latest published release of the
// repository named in src/data/update-feed.ts. `releases/latest` leaves out drafts and pre-releases. The
// request carries nothing about the person or the projects (no cookies, no referrer). What comes back is
// read and checked by core/updates.ts; this file only asks, with a time limit, and says why it could not.
// It never throws: every failure is an `UpdateOutcome` with the honest reason.

import { faultFromStatus, parseRelease, type UpdateOutcome } from '../core/updates';
import { UPDATE_FEED, type UpdateFeed } from '../data/update-feed';

/** How long the feed has to answer, whole answer included. */
export const UPDATE_TIMEOUT_MS = 10_000;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function latestReleaseUrl(feed: UpdateFeed = UPDATE_FEED): string {
  return `https://api.github.com/repos/${encodeURIComponent(feed.owner)}/${encodeURIComponent(feed.repo)}/releases/latest`;
}

const fail = (code: 'OFFLINE' | 'TIMEOUT' | 'BAD_FEED'): UpdateOutcome => ({ ok: false, fault: { code } });

export async function fetchLatestRelease(opts: { feed?: UpdateFeed; fetch?: FetchFn; timeoutMs?: number } = {}): Promise<UpdateOutcome> {
  const fetchFn: FetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The limit is also a race: a fetch that ignores the abort signal cannot hold the check forever.
  const limit = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve('timeout');
    }, opts.timeoutMs ?? UPDATE_TIMEOUT_MS);
  });
  const ask = async (): Promise<UpdateOutcome> => {
    let res: Response;
    try {
      res = await fetchFn(latestReleaseUrl(opts.feed), { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      // A rejected fetch is a network that is not there (or the time limit's abort).
      return fail(timedOut ? 'TIMEOUT' : 'OFFLINE');
    }
    if (!res.ok) return { ok: false, fault: faultFromStatus(res.status, (name) => res.headers.get(name)) };
    let json: unknown;
    try {
      json = JSON.parse(await res.text());
    } catch {
      return fail(timedOut ? 'TIMEOUT' : 'BAD_FEED');
    }
    const release = parseRelease(json);
    return release ? { ok: true, release } : fail('BAD_FEED');
  };
  try {
    const out = await Promise.race([ask(), limit]);
    return out === 'timeout' ? fail('TIMEOUT') : out;
  } finally {
    clearTimeout(timer);
  }
}
