// U15, the step buttons of the number field in a browser (headless Chromium, the real component through Vite, a
// fake clock for the press-and-hold): a click steps by `step` (Shift finer, Ctrl coarser); holding repeats after a
// pause and the whole hold is one gesture, so one entry in the store's undo history; the value is clamped and the
// button at its limit is disabled; a disabled field does nothing; the buttons start no drag, open no editor and take
// no focus (the spinbutton keeps the keyboard); typing, dragging and the arrow keys still work; onHold / onRelease
// go around a press; the slider's field and the time field have them too. Skipped without Chromium.

import { existsSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STEP_REPEAT_DELAY_MS, STEP_REPEAT_MS } from '../src/ui/components/controls';

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

describe.skipIf(!executablePath)('the step buttons of the number field, in a browser', { timeout: 300000 }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url = '';

  beforeAll(async () => {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('the test server has no address');
    url = base;
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox'] });
  }, 120000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  /** A fresh page with the fields, on a paused fake clock (time moves only when the test says). */
  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 600, height: 600 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(`${url}tests/browser/number-field.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.nfReady === true, undefined, { timeout: 120000, polling: 50 });
    // The installed clock still flows with real time: stop it, so that a loaded machine does not repeat a press.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1000);
    return page;
  }

  const sel = (name: string, part: 'up' | 'down' | 'field' | 'value' | 'range') =>
    `[data-name="${name}"] ${part === 'up' ? '.num-up' : part === 'down' ? '.num-down' : part === 'value' ? '.num-value' : part === 'range' ? 'input[type=range]' : '.num'}`;
  const centre = async (page: Page, selector: string) => {
    const b = await page.locator(selector).boundingBox();
    if (!b) throw new Error(`${selector} has no box`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const value = (page: Page, name: string) => page.evaluate((n) => window.nf!.value(n), name);
  const shown = (page: Page, name: string) => page.locator(sel(name, 'value')).textContent();
  const now = (page: Page, name: string) => page.locator(sel(name, 'field')).getAttribute('aria-valuenow').then(Number);
  const undoCount = (page: Page) => page.evaluate(() => window.nf!.undoCount());
  const log = (page: Page) => page.evaluate(() => [...window.nf!.log]);
  /** Presses a button with the mouse and lets it go after `ms` of the fake clock. */
  const press = async (page: Page, selector: string, ms = 0) => {
    const c = await centre(page, selector);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    if (ms > 0) await page.clock.runFor(ms);
    await page.mouse.up();
  };

  it('every field has the pair, at its right end and inside its frame, one line high, and they are not tab stops', async () => {
    const page = await open();
    const facts = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.num')].map((n) => {
        const r = n.getBoundingClientRect();
        const steps = n.querySelector('.num-steps')!.getBoundingClientRect();
        const buttons = [...n.querySelectorAll<HTMLButtonElement>('.num-step')];
        const content = [...n.querySelectorAll('.num-value, .num-unit, .num-label')].map((e) => e.getBoundingClientRect().right);
        return {
          name: n.getAttribute('aria-label'),
          height: r.height,
          inside: steps.left >= r.left && steps.right <= r.right && steps.top >= r.top && steps.bottom <= r.bottom,
          atRight: r.right - steps.right <= 2,
          clear: steps.left >= Math.max(...content) - 0.5,
          tabIndex: buttons.map((b) => b.tabIndex),
          labels: buttons.map((b) => b.getAttribute('aria-label')),
          compact: n.classList.contains('is-compact'),
        };
      }),
    );
    expect(facts.map((f) => f.name)).toEqual(['Bounded', 'Free', 'Off', 'Slider', 'Time', 'Labelled']);
    for (const f of facts) {
      expect(f.height, f.name!).toBe(26);
      expect(f.inside && f.atRight && f.clear, `${f.name}: the pair sits at the right end, inside, clear of the value`).toBe(true);
      expect(f.tabIndex).toEqual([-1, -1]);
      expect(f.labels).toEqual(['Increase', 'Decrease']);
    }
    // A slider's field and a field with an inline label have the compact pair; the others the regular one.
    expect(facts.map((f) => f.compact)).toEqual([false, false, false, true, false, true]);
    await page.context().close();
  });

  it('a click steps by the step; Shift steps a tenth, Ctrl ten steps; each click is its own undo entry', async () => {
    const page = await open();
    const undo0 = await undoCount(page);
    await page.click(sel('bounded', 'up'));
    expect(await value(page, 'bounded')).toBe(0.5);
    await page.click(sel('bounded', 'down'));
    await page.click(sel('bounded', 'down'));
    expect(await value(page, 'bounded')).toBe(-0.5);
    await page.click(sel('bounded', 'up'), { modifiers: ['Shift'] });
    expect(await value(page, 'bounded')).toBe(-0.45);
    expect(await shown(page, 'bounded')).toBe('-0.45');
    await page.click(sel('free', 'up'), { modifiers: ['Control'] });
    expect(await value(page, 'free')).toBe(10);
    await page.click(sel('free', 'down'), { modifiers: ['Shift'] });
    expect(await value(page, 'free')).toBe(9.9);
    expect(await undoCount(page)).toBe(undo0 + 6);
    await page.context().close();
  });

  it('holding repeats after a pause at a steady rate, and the whole hold is one undo entry', async () => {
    const page = await open();
    const undo0 = await undoCount(page);
    const c = await centre(page, sel('free', 'up'));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    expect(await value(page, 'free')).toBe(1);
    await page.clock.runFor(STEP_REPEAT_DELAY_MS - 10);
    expect(await value(page, 'free'), 'nothing more before the pause').toBe(1);
    await page.clock.runFor(10);
    expect(await value(page, 'free')).toBe(2);
    await page.clock.runFor(STEP_REPEAT_MS * 5);
    expect(await value(page, 'free'), 'then one step each interval').toBe(7);
    // Shift while holding: the next steps are finer.
    await page.keyboard.down('Shift');
    await page.clock.runFor(STEP_REPEAT_MS * 2);
    await page.keyboard.up('Shift');
    expect(await value(page, 'free')).toBe(7.2);
    await page.mouse.up();
    await page.clock.runFor(1000);
    expect(await value(page, 'free'), 'nothing after the release').toBe(7.2);
    expect(await undoCount(page), 'one entry for the whole hold').toBe(undo0 + 1);
    await page.evaluate(() => window.nf!.undo());
    expect(await value(page, 'free'), 'one undo takes the whole hold back').toBe(0);
    expect(await now(page, 'free')).toBe(0);
    // Let go outside the button: the hold still ends there.
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 150, c.y + 120);
    await page.clock.runFor(STEP_REPEAT_DELAY_MS + STEP_REPEAT_MS);
    await page.mouse.up();
    const after = await value(page, 'free');
    await page.clock.runFor(1000);
    expect(await value(page, 'free')).toBe(after);
    expect(after).toBe(3);
    await page.context().close();
  });

  it('the value is clamped, the button at its limit is disabled, and a held button stops there', async () => {
    const page = await open();
    expect(await page.locator(sel('bounded', 'up')).isDisabled()).toBe(false);
    await press(page, sel('bounded', 'up'), STEP_REPEAT_DELAY_MS + STEP_REPEAT_MS * 40);
    expect(await value(page, 'bounded'), 'up to the maximum and no further').toBe(5);
    expect(await page.locator(sel('bounded', 'up')).isDisabled()).toBe(true);
    expect(await page.locator(sel('bounded', 'down')).isDisabled()).toBe(false);
    const undo1 = await undoCount(page);
    await page.locator(sel('bounded', 'up')).click({ force: true });
    expect(await value(page, 'bounded')).toBe(5);
    expect(await undoCount(page), 'a click at the limit changes nothing').toBe(undo1);
    // Ctrl steps ten at a time: from 5 to 0, then to -5, the minimum, where ▼ is disabled.
    await page.click(sel('bounded', 'down'), { modifiers: ['Control'] });
    expect(await value(page, 'bounded')).toBe(0);
    await page.click(sel('bounded', 'down'), { modifiers: ['Control'] });
    expect(await value(page, 'bounded')).toBe(-5);
    expect(await page.locator(sel('bounded', 'down')).isDisabled()).toBe(true);
    expect(await page.locator(sel('bounded', 'up')).isDisabled()).toBe(false);
    // The keyboard is clamped the same way, and the buttons follow it.
    await page.focus(sel('bounded', 'field'));
    await page.keyboard.press('ArrowUp');
    expect(await value(page, 'bounded')).toBe(-4.5);
    expect(await page.locator(sel('bounded', 'down')).isDisabled()).toBe(false);
    await page.context().close();
  });

  it('a disabled field does nothing, and its buttons are disabled; setDisabled switches them', async () => {
    const page = await open();
    expect(await page.locator(sel('off', 'up')).isDisabled()).toBe(true);
    expect(await page.locator(sel('off', 'down')).isDisabled()).toBe(true);
    const undo0 = await undoCount(page);
    await press(page, sel('off', 'up'), STEP_REPEAT_DELAY_MS * 2);
    await page.locator(sel('off', 'down')).click({ force: true });
    expect(await now(page, 'off')).toBe(2);
    expect(await undoCount(page)).toBe(undo0);
    expect(await log(page)).toEqual([]);
    await page.evaluate(() => window.nf!.setDisabled('off', false));
    await page.click(sel('off', 'up'));
    expect(await value(page, 'off')).toBe(3);
    await page.evaluate(() => window.nf!.setDisabled('off', true));
    expect(await page.locator(sel('off', 'up')).isDisabled()).toBe(true);
    expect(await page.locator(sel('off', 'field')).getAttribute('aria-disabled')).toBe('true');
    // Disabled while held: the hold ends there (and says so).
    await page.evaluate(() => window.nf!.setDisabled('free', false));
    const c = await centre(page, sel('free', 'up'));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.evaluate(() => window.nf!.setDisabled('free', true));
    await page.clock.runFor(STEP_REPEAT_DELAY_MS + STEP_REPEAT_MS * 4);
    await page.mouse.up();
    expect(await value(page, 'free')).toBe(1);
    expect(await log(page)).toEqual(['hold:off', 'release:off', 'hold:free', 'release:free']);
    await page.context().close();
  });

  it('onHold and onRelease go around a press, so costly work waits for the release', async () => {
    const page = await open();
    const c = await centre(page, sel('bounded', 'up'));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    expect(await log(page)).toEqual(['hold:bounded']);
    await page.clock.runFor(STEP_REPEAT_DELAY_MS + STEP_REPEAT_MS * 3);
    expect(await log(page), 'still held while it repeats').toEqual(['hold:bounded']);
    await page.mouse.up();
    expect(await log(page)).toEqual(['hold:bounded', 'release:bounded']);
    await page.click(sel('slider', 'down'));
    expect(await log(page)).toEqual(['hold:bounded', 'release:bounded', 'hold:slider', 'release:slider']);
    await page.context().close();
  });

  it('the buttons start no drag, open no editor and leave the keyboard on the spinbutton', async () => {
    const page = await open();
    // A press on ▲ that moves sideways is a press, not a drag.
    const c = await centre(page, sel('free', 'up'));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 120, c.y, { steps: 6 });
    expect(await page.locator(sel('free', 'field')).evaluate((e) => e.classList.contains('is-dragging'))).toBe(false);
    await page.mouse.up();
    expect(await value(page, 'free')).toBe(1);
    // The focus is the field's, so the arrow keys follow the click.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Free');
    await page.keyboard.press('ArrowUp');
    expect(await value(page, 'free')).toBe(2);
    // A double click on a button is two steps, not the editor.
    await page.dblclick(sel('free', 'up'));
    expect(await page.locator(`${sel('free', 'field')} input`).count()).toBe(0);
    expect(await value(page, 'free')).toBe(4);
    // Tab from the button before goes to the first field, then the next field: never to a step button.
    await page.focus('#before');
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName) || ''));
    }
    expect(order).toEqual(['Bounded', 'Free', 'Slider', 'Slider', 'Time', 'Labelled']);
    await page.context().close();
  });

  it('typing, dragging and the arrow keys still work, each one gesture', async () => {
    const page = await open();
    const undo0 = await undoCount(page);
    await page.dblclick(sel('bounded', 'value'));
    await page.keyboard.press('Control+A');
    await page.keyboard.type('2,5');
    await page.keyboard.press('Enter');
    expect(await value(page, 'bounded')).toBe(2.5);
    // A drag of the value (not of the buttons): the bounded field moves its range over 240 px.
    const v = await centre(page, sel('free', 'value'));
    await page.mouse.move(v.x, v.y);
    await page.mouse.down();
    await page.mouse.move(v.x + 30, v.y, { steps: 5 });
    await page.mouse.up();
    expect(await value(page, 'free')).toBe(30);
    expect(await log(page), 'a drag holds and releases too').toEqual(['hold:free', 'release:free']);
    await page.focus(sel('free', 'field'));
    await page.keyboard.press('ArrowDown');
    expect(await value(page, 'free')).toBe(29);
    expect(await undoCount(page)).toBe(undo0 + 3);
    // While typing, a press of a button takes what was typed first, then steps from it.
    await page.dblclick(sel('free', 'value'));
    await page.keyboard.press('Control+A');
    await page.keyboard.type('100');
    await page.click(sel('free', 'up'));
    expect(await page.locator(`${sel('free', 'field')} input`).count()).toBe(0);
    expect(await value(page, 'free')).toBe(101);
    await page.context().close();
  });

  it("the slider's field steps the slider, and the time field steps a minute and is typed as a time", async () => {
    const page = await open();
    await page.click(sel('slider', 'up'));
    expect(await value(page, 'slider')).toBe(0.6);
    expect(await page.locator(sel('slider', 'range')).inputValue()).toBe('0.6');
    await page.click(sel('time', 'up'));
    expect(await now(page, 'time')).toBe(180);
    expect(await shown(page, 'time')).toBe('00:03:00');
    await page.click(sel('time', 'down'), { modifiers: ['Shift'] });
    expect(await now(page, 'time')).toBe(174);
    await page.dblclick(sel('time', 'value'));
    expect(await page.locator(`${sel('time', 'field')} input`).inputValue(), 'typing starts from the time shown').toBe('00:02:54');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1:30:05');
    await page.keyboard.press('Enter');
    expect(await now(page, 'time')).toBe(5405);
    expect(await shown(page, 'time')).toBe('01:30:05');
    // Not a time, or nothing: refused.
    for (const text of ['soon', '0', '-5']) {
      await page.dblclick(sel('time', 'value'));
      await page.keyboard.press('Control+A');
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      expect(await now(page, 'time'), text).toBe(5405);
    }
    await page.context().close();
  });

  it('a click with no pointer (an assistive technology, a script) is one step', async () => {
    const page = await open();
    const undo0 = await undoCount(page);
    await page.evaluate(() => (document.querySelector('[data-name="bounded"] .num-up') as HTMLButtonElement).click());
    expect(await value(page, 'bounded')).toBe(0.5);
    expect(await undoCount(page)).toBe(undo0 + 1);
    expect(await log(page)).toEqual(['hold:bounded', 'release:bounded']);
    await page.context().close();
  });
});
