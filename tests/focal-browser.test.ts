// The focal length's switch in a real browser (phase C2, the owner's report 1.7: "either the camera gets closer or the
// focused object / point"). The page of tests/browser/focal-page.ts draws two glowing cards with the preview engine (headless
// Chromium, SwiftShader), changes the focal length through the store the way the inspector's field does (a drag is one
// gesture, a press of the arrows one more) and reads the canvas back before and after. With *Keep the size of what is
// in focus* on, the card on the plane in focus keeps its size in pixels within 1 % (and its place), with the focus at
// the target, on a point clicked on the other card, and through K3's straight verticals; off, it grows by the focal
// ratio. Each change is one undo entry. Skipped without Chromium (REPACKSHOT_CHROMIUM, /opt/pw-browsers).

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardShot, FocalRun } from './browser/focal-page';

function findChromium(): string | null {
  const fromEnv = process.env.REPACKSHOT_CHROMIUM;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(`${base}/chromium`)) return `${base}/chromium`;
  try {
    const entries = readdirSync(base)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const e of entries) if (existsSync(`${base}/${e}/chrome-linux/chrome`)) return `${base}/${e}/chrome-linux/chrome`;
  } catch {
    // No browsers installed.
  }
  return null;
}

const executablePath = findChromium();
const W = 640;
const H = 400;

/** The size of a card on the image: the side of a square of its lit pixels, and its box. */
const side = (c: CardShot) => Math.sqrt(c.pixels);
const ratio = (a: number, b: number) => a / b;

describe.skipIf(!executablePath)('the focal length’s switch, in a browser', { timeout: 300000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let runs: Record<string, FocalRun> = {};

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('the test server has no address');
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}tests/browser/focal.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.focalReady === true, null, { timeout: 120000 });
    const list = (await page.evaluate(([w, h]) => window.runFocal!(w, h), [W, H] as const)) as FocalRun[];
    runs = Object.fromEntries(list.map((r) => [r.name, r]));
    expect(errors).toEqual([]);
  }, 300000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('draws both cards before and after, big enough to measure', () => {
    for (const r of Object.values(runs)) {
      for (const c of [r.before.red, r.before.green, r.after.red, r.after.green]) expect(c.pixels, r.name).toBeGreaterThan(400);
    }
  });

  it('on, the focus at the target: a drag from 50 to 85 mm moves the camera back and the card in focus keeps its size within 1 %', () => {
    const r = runs.distance;
    expect(r.focal).toEqual([50, 85]);
    expect(r.distance[1] / r.distance[0]).toBeCloseTo(85 / 50, 9);
    const { red: a } = r.before;
    const { red: b } = r.after;
    expect(Math.abs(ratio(side(b), side(a)) - 1)).toBeLessThan(0.01);
    expect(Math.abs(ratio(b.width, a.width) - 1)).toBeLessThan(0.01);
    expect(Math.abs(ratio(b.height, a.height) - 1)).toBeLessThan(0.01);
    // In its place too, within a pixel.
    expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeLessThan(1);
    // The perspective changes: the card behind it grows (the camera is farther from both).
    expect(ratio(side(r.after.green), side(r.before.green))).toBeGreaterThan(1.05);
    expect(r.entries).toBe(1);
  });

  it('off, the same drag leaves the camera where it is and the card grows by the focal ratio', () => {
    const r = runs.off;
    expect(r.distance[1]).toBe(r.distance[0]);
    expect(ratio(side(r.after.red), side(r.before.red))).toBeCloseTo(85 / 50, 1);
    expect(Math.abs(ratio(r.after.red.width, r.before.red.width) / (85 / 50) - 1)).toBeLessThan(0.02);
    expect(r.entries).toBe(1);
  });

  it('on, the focus on a point of the other card: a press of the arrows to 35 mm keeps that card, not the one at the target', () => {
    const r = runs.point;
    const { green: a } = r.before;
    const { green: b } = r.after;
    expect(Math.abs(ratio(side(b), side(a)) - 1)).toBeLessThan(0.01);
    expect(Math.abs(ratio(b.width, a.width) - 1)).toBeLessThan(0.01);
    expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeLessThan(1);
    // The camera came closer, so the card in front of the point grew.
    expect(r.distance[1]).toBeLessThan(r.distance[0]);
    expect(ratio(side(r.after.red), side(r.before.red))).toBeGreaterThan(1.05);
    expect(r.entries).toBe(1);
  });

  it('on, with straight verticals: the level camera that is rendered keeps the card in focus within 1 %', () => {
    const r = runs.verticals;
    const { red: a } = r.before;
    const { red: b } = r.after;
    expect(Math.abs(ratio(side(b), side(a)) - 1)).toBeLessThan(0.01);
    expect(Math.abs(ratio(b.width, a.width) - 1)).toBeLessThan(0.01);
    expect(Math.abs(ratio(b.height, a.height) - 1)).toBeLessThan(0.01);
    expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeLessThan(1);
    expect(r.entries).toBe(1);
  });
});
