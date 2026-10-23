// Settings ▸ AI post-processing ▸ Model by API (phase X7, UI.md §2.9, AI-POST.md §8): the rows drawn by their own code.
// *Run the model*, *API*, the passes, the time limit and the tries are ordinary setting rows; here are the endpoint (a
// preset's summary, or the generic endpoint's form), the API key (stored on this computer only, shown masked, never
// read back) and the hosts the person allowed (revocable). Everything shown comes from the settings, the presets'
// data and the key store; nothing is invented.

import { apiConnection } from '../../core/ai-api-settings';
import { API_BODIES, API_METHODS, API_RESPONSES, validKey, type ApiEndpoint, type ApiOptions, type ApiProblem, type ApiProvider } from '../../core/ai-remote';
import type { Settings } from '../../core/settings';
import { GENERIC_ENDPOINT } from '../../data/ai-api-presets';
import { apiErrorText, consentPatch, consentQuestion } from '../ai-api';
import * as cmd from '../commands';
import { numberField, select, textArea, textField } from '../components/controls';
import { showConfirmIn } from '../components/widgets';
import { h, icon } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { t } from '../strings';
import { rowShell } from './settings-rows';

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'sw-link' }, text);

/** A problem of the endpoint in words. */
export function problemText(p: ApiProblem): string {
  return t(dyn(`set.ai.api.problem.${p.code}`), { detail: p.detail ?? '' });
}

/** "Name: value" lines as headers (empty lines and lines without a colon are dropped). */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** "1024x1024, 1536x1024" as sizes (anything else is dropped). */
export function parseSizes(text: string): [number, number][] {
  return [...text.matchAll(/(\d{2,5})\s*[x×]\s*(\d{2,5})/gi)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
}

const headersText = (hd: Record<string, string>) =>
  Object.entries(hd)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
const sizesText = (s: [number, number][]) => s.map(([w, h]) => `${w}x${h}`).join(', ');

/** What identifies the configuration a ping result was measured for: provider, endpoint, options, key present. */
export function pingKey(provider: ApiProvider, endpoint: ApiEndpoint, options: ApiOptions, hasKey: boolean): string {
  return JSON.stringify([provider, endpoint, options, hasKey]);
}

/**
 * What the ping result line shows after a refresh, and whether the stored result survives it. A finished result
 * stays while the configuration it was measured for still holds; a changed endpoint or options, or a key that
 * is no longer stored, drops it (a result measured with a key must not stand once the key is gone). While a
 * test runs the caller leaves the line alone.
 */
export function pingLine(
  state: { result: string | null; resultKey: string },
  key: string,
  hasKey: boolean,
  noKeyText: string,
): { text: string; result: string | null; resultKey: string } {
  if (!hasKey) return { text: noKeyText, result: null, resultKey: '' };
  if (state.result !== null && state.resultKey === key) return { text: state.result, result: state.result, resultKey: state.resultKey };
  return { text: '', result: null, resultKey: '' };
}

/** The endpoint: a preset's summary and notes, or the generic endpoint's form, with what is still missing. */
export function endpointRow(ctx: Ctx, scope: Scope): HTMLElement {
  const parts = rowShell('ai.apiEndpoint', { control: null, stacked: true });
  const body = h('div', { class: 'sw-value-block sw-api', 'data-value': 'ai.apiEndpoint' });
  parts.el.insertBefore(body, parts.ctrlEl);
  // The ping test: one minimal call against the endpoint (a synthetic 512 × 512 image, never a render). The button
  // is disabled while the endpoint has problems, while no key is stored for a host that takes one, or while a
  // test is running; the result line says what came back, in words — and keeps saying it until the configuration
  // changes, so the refresh after a test no longer wipes it.
  const pingBtn = h('button', { type: 'button', class: 'btn', 'data-api-ping': '' }, t('set.ai.api.ping'));
  const pingResult = h('div', { class: 'note', role: 'status', 'aria-live': 'polite', 'data-api-ping-result': '' });
  parts.el.insertBefore(h('div', { class: 'sw-inline sw-api-ping' }, pingBtn, pingResult), parts.ctrlEl);
  let pingTesting = false;
  let pingRun = 0;
  // The last finished result, and the configuration it was measured for.
  let pingKeptText: string | null = null;
  let pingKeptKey = '';
  const refreshPing = async () => {
    const run = ++pingRun;
    const c = apiConnection(ctx.ui.get().settings);
    const store = ctx.services.apiKeys ?? null;
    const hasKey = !c.needsKey || (c.host !== null && store !== null && (await store.has(c.host).catch(() => false)));
    if (run !== pingRun) return;
    pingBtn.disabled = !ctx.services.apiPing || c.problems.length > 0 || !hasKey || pingTesting;
    if (pingTesting) return;
    const line = pingLine({ result: pingKeptText, resultKey: pingKeptKey }, pingKey(c.provider, c.endpoint, c.options, hasKey), hasKey, t('set.ai.api.pingNoKey', { host: c.host ?? '' }));
    pingKeptText = line.result;
    pingKeptKey = line.resultKey;
    pingResult.textContent = line.text;
  };
  pingBtn.addEventListener('click', () => {
    const ping = ctx.services.apiPing;
    if (!ping || pingTesting) return;
    const c = apiConnection(ctx.ui.get().settings);
    if (c.problems.length > 0) return;
    pingTesting = true;
    pingBtn.disabled = true;
    pingResult.textContent = t('set.ai.api.pinging');
    void ping(c.endpoint, c.options, new AbortController().signal)
      .then(() => {
        pingKeptText = t('set.ai.api.pingOk');
        pingKeptKey = pingKey(c.provider, c.endpoint, c.options, true);
        pingResult.textContent = pingKeptText;
      })
      .catch((e: unknown) => {
        pingKeptText = apiErrorText(e) ?? t('set.ai.api.pingFailed', { reason: e instanceof Error ? e.message : String(e) });
        pingKeptKey = pingKey(c.provider, c.endpoint, c.options, true);
        pingResult.textContent = pingKeptText;
      })
      .finally(() => {
        pingTesting = false;
        void refreshPing();
      });
  });
  scope.watch(
    (_s, u) => [u.settings['ai.apiProvider'], u.settings['ai.apiEndpoint'], u.settings['ai.apiSendPasses'], u.settings['ai.apiTimeout'], u.settings['ai.apiAttempts'], u.aiApiKeys] as const,
    () => void refreshPing(),
    (a, b) => a.every((x, i) => x === b[i]),
  );
  const status = h('div', { class: 'note sw-api-status', role: 'status', 'aria-live': 'polite' });
  const set = (patch: Partial<ApiEndpoint>) => cmd.setSetting(ctx, 'ai.apiEndpoint', { ...ctx.ui.get().settings['ai.apiEndpoint'], ...patch });
  let drawn = '';
  const draw = (s: Settings) => {
    const c = apiConnection(s);
    const key = c.provider === 'GENERIC' ? 'GENERIC' : c.provider;
    if (key !== drawn) {
      drawn = key;
      body.replaceChildren();
      if (c.provider !== 'GENERIC') {
        const e = c.endpoint;
        body.append(
          h('code', { class: 'sw-path', translate: 'no', 'data-api-summary': '' }, t('set.ai.api.presetLine', { method: e.method, url: e.url, body: t(dyn(`set.ai.api.body.${e.body}`)), answer: e.response === 'JSON' ? e.responsePath : t('set.ai.api.response.IMAGE') })),
          h('p', { class: 'note', 'data-api-untested': '' }, t('set.ai.api.untested'), ' ', c.preset.docs ? link(c.preset.docs, t('set.ai.api.docs')) : null),
          ...(c.preset.takes.strength ? [] : [h('p', { class: 'note' }, t(c.preset.takes.seed ? 'set.ai.api.takesNoStrengthNegative' : 'set.ai.api.takesNone'))]),
        );
      } else {
        const e = s['ai.apiEndpoint'];
        const url = textField(e.url, (v) => set({ url: v.trim() }), t('set.ai.api.url'), 'https://');
        const method = select(API_METHODS.map((m) => ({ value: m, label: m })), e.method, (v) => set({ method: v as ApiEndpoint['method'] }), t('set.ai.api.method'));
        const authHeader = textField(e.authHeader, (v) => set({ authHeader: v.trim() }), t('set.ai.api.authHeader'));
        authHeader.el.setAttribute('data-tip', t('set.ai.api.authHeaderTip'));
        const authPrefix = textField(e.authPrefix, (v) => set({ authPrefix: v }), t('set.ai.api.authPrefix'));
        const headers = textArea({ value: headersText(e.headers), rows: 2, maxLength: 4096, ariaLabel: t('set.ai.api.headers'), onCommit: (v) => set({ headers: parseHeaders(v) }) });
        headers.el.setAttribute('data-tip', t('set.ai.api.headersTip'));
        const bodyKind = select(API_BODIES.map((b) => ({ value: b, label: t(dyn(`set.ai.api.body.${b}`)) })), e.body, (v) => set({ body: v as ApiEndpoint['body'] }), t('set.ai.api.body'));
        const template = textArea({ value: e.template, rows: 7, maxLength: 16384, ariaLabel: t('set.ai.api.template'), onCommit: (v) => set({ template: v }) });
        template.el.classList.add('sw-api-template');
        template.el.spellcheck = false;
        const response = select(API_RESPONSES.map((r) => ({ value: r, label: t(dyn(`set.ai.api.response.${r}`)) })), e.response, (v) => set({ response: v as ApiEndpoint['response'] }), t('set.ai.api.response'));
        const path = textField(e.responsePath, (v) => set({ responsePath: v.trim() }), t('set.ai.api.responsePath'), 'data.0.b64_json');
        path.el.setAttribute('data-tip', t('set.ai.api.responsePathTip'));
        const maxSide = numberField({ value: e.maxSide, min: 64, max: 4096, step: 16, unit: 'px', ariaLabel: t('set.ai.api.maxSide'), onChange: (v) => set({ maxSide: Math.round(v) }) });
        const multipleOf = numberField({ value: e.multipleOf, min: 1, max: 256, step: 1, ariaLabel: t('set.ai.api.multipleOf'), onChange: (v) => set({ multipleOf: Math.round(v) }) });
        const sizes = textField(sizesText(e.sizes), (v) => set({ sizes: parseSizes(v) }), t('set.ai.api.sizes'), '1024x1024, 1536x1024');
        sizes.el.setAttribute('data-tip', t('set.ai.api.sizesTip'));
        const fieldEl = (label: string, el: HTMLElement, wide = false) => h('label', { class: `sw-api-field${wide ? ' is-wide' : ''}` }, h('span', { class: 'note' }, label), el);
        const reset = h('button', { type: 'button', class: 'btn', onclick: () => cmd.setSetting(ctx, 'ai.apiEndpoint', { ...GENERIC_ENDPOINT, headers: { ...GENERIC_ENDPOINT.headers }, sizes: [] }) }, icon('refresh', 14), t('set.ai.api.reset'));
        body.append(
          h(
            'div',
            { class: 'sw-api-form', 'data-api-form': '' },
            fieldEl(t('set.ai.api.url'), url.el, true),
            fieldEl(t('set.ai.api.method'), method.el),
            fieldEl(t('set.ai.api.authHeader'), authHeader.el),
            fieldEl(t('set.ai.api.authPrefix'), authPrefix.el),
            fieldEl(t('set.ai.api.headers'), headers.el, true),
            fieldEl(t('set.ai.api.body'), bodyKind.el),
            fieldEl(t('set.ai.api.response'), response.el),
            fieldEl(t('set.ai.api.template'), template.el, true),
            h('p', { class: 'note is-wide' }, t('set.ai.api.templateNote')),
            fieldEl(t('set.ai.api.responsePath'), path.el),
            fieldEl(t('set.ai.api.maxSide'), maxSide.el),
            fieldEl(t('set.ai.api.multipleOf'), multipleOf.el),
            fieldEl(t('set.ai.api.sizes'), sizes.el),
          ),
          h('div', { class: 'sw-inline' }, reset),
        );
        // Undo-free settings: what comes back is what was set; keep the fields in step (a reset).
        scope.watch(
          (_s, u) => u.settings['ai.apiEndpoint'],
          (v) => {
            url.set(v.url);
            method.set(v.method);
            authHeader.set(v.authHeader);
            authPrefix.set(v.authPrefix);
            if (document.activeElement !== headers.el) headers.set(headersText(v.headers));
            bodyKind.set(v.body);
            if (document.activeElement !== template.el) template.set(v.template);
            response.set(v.response);
            path.set(v.responsePath);
            maxSide.set(v.maxSide);
            multipleOf.set(v.multipleOf);
            sizes.set(sizesText(v.sizes));
          },
        );
      }
    }
    body.append(status);
    const problems = c.problems.map(problemText);
    status.replaceChildren(...(problems.length ? problems.map((p) => h('div', { class: 'sw-warn', 'data-api-problem': '' }, h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), p)) : [h('span', { 'data-api-ready': '' }, t('set.ai.api.ready', { host: c.host ?? '' }))]));
  };
  scope.watch(
    (_s, u) => [u.settings['ai.apiProvider'], u.settings['ai.apiEndpoint'], u.settings['ai.apiSendPasses'], u.settings['ai.apiTimeout'], u.settings['ai.apiAttempts']] as const,
    () => draw(ctx.ui.get().settings),
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return parts.el;
}

/** The API key: stored for the endpoint's host, shown masked, saved and removed here; never shown back. */
export function keyRow(ctx: Ctx, scope: Scope): HTMLElement {
  // Read at each use: the store is known once the platform has answered (the launcher, or this browser).
  const keys = () => ctx.services.apiKeys ?? null;
  const parts = rowShell('ai.apiKey', { aux: t('set.ai.apiKey.aux'), control: null, stacked: true });
  const state = h('div', { class: 'note tabular', 'data-api-key-state': '', role: 'status', 'aria-live': 'polite' });
  const input = h('input', { type: 'password', class: 'text-input sw-api-key', autocomplete: 'off', spellcheck: 'false', placeholder: t('set.ai.api.keyPlaceholder'), 'aria-label': t('set.ai.apiKey'), 'data-api-key-input': '' }) as HTMLInputElement;
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const save = h('button', { type: 'button', class: 'btn btn-primary', 'data-api-key-save': '' }, t('set.ai.api.keySave'));
  const forget = h('button', { type: 'button', class: 'btn', 'data-api-key-forget': '' }, t('set.ai.api.keyForget'));
  const where = h('p', { class: 'note', 'data-api-key-where': '' });
  const msg = h('div', { class: 'sw-warn', role: 'alert' });
  const box = h('div', { class: 'sw-value-block sw-api-keybox' }, state, h('div', { class: 'sw-inline' }, input, save, forget), msg, where);
  parts.el.insertBefore(box, parts.ctrlEl);
  let host: string | null = null;
  const refresh = async () => {
    const store = keys();
    const c = apiConnection(ctx.ui.get().settings);
    host = c.host;
    msg.replaceChildren();
    where.textContent = store ? t(store.where === 'LAUNCHER' ? 'set.ai.api.keyWhereDesktop' : 'set.ai.api.keyWhereWeb') : '';
    const usable = store !== null && host !== null && c.needsKey;
    for (const el of [input, save, forget] as (HTMLInputElement | HTMLButtonElement)[]) el.disabled = !usable;
    if (!store) return void (state.textContent = t('set.ai.api.keyUnavailable'));
    if (!host) return void (state.textContent = t('set.ai.api.keyNoHost'));
    if (!c.needsKey) return void (state.textContent = t('set.ai.api.keyNotNeeded'));
    const stored = (await store.list().catch(() => [])).find((k) => k.host === host);
    state.textContent = stored ? t('set.ai.api.keyStored', { host, masked: stored.masked }) : t('set.ai.api.keyNone', { host });
    forget.disabled = !stored;
  };
  const fail = (reason: string) => msg.replaceChildren(h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), t('set.ai.api.keyFailed', { reason }));
  save.addEventListener('click', () => {
    const store = keys();
    const key = input.value;
    if (!store || !host) return;
    if (!validKey(key)) return void msg.replaceChildren(h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), t('set.ai.api.keyInvalid'));
    void store
      .save(host, key)
      .then(() => {
        // The field forgets it at once: the key is never kept in the page longer than the call.
        input.value = '';
        ctx.ui.set({ aiApiKeys: ctx.ui.get().aiApiKeys + 1 });
      })
      .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
  });
  forget.addEventListener('click', () => {
    const store = keys();
    if (!store || !host) return;
    void store
      .forget(host)
      .then(() => ctx.ui.set({ aiApiKeys: ctx.ui.get().aiApiKeys + 1 }))
      .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
  });
  scope.watch(
    (_s, u) => [u.settings['ai.apiProvider'], u.settings['ai.apiEndpoint'], u.aiApiKeys] as const,
    () => void refresh(),
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return parts.el;
}

/** The hosts allowed, each with Revoke, and Allow… for the endpoint's own when it is not one of them. */
export function consentRow(ctx: Ctx, scope: Scope): HTMLElement {
  const parts = rowShell('ai.apiConsent', { control: null, stacked: true });
  const list = h('div', { class: 'sw-value-block sw-api-hosts', 'data-api-hosts': '' });
  const ask = h('div', { class: 'sw-api-ask' });
  parts.el.insertBefore(h('div', null, list, ask), parts.ctrlEl);
  const draw = () => {
    const s = ctx.ui.get().settings;
    const hosts = s['ai.apiConsent'];
    const own = apiConnection(s).host;
    list.replaceChildren(
      ...(hosts.length === 0 ? [h('p', { class: 'note' }, t('set.ai.api.consentNone'))] : []),
      ...hosts.map((host) =>
        h(
          'div',
          { class: 'sw-inline sw-api-host', 'data-host': host },
          h('code', { class: 'sw-path', translate: 'no' }, host),
          h('button', { type: 'button', class: 'btn', 'data-revoke': host, onclick: () => cmd.setSetting(ctx, 'ai.apiConsent', consentPatch(ctx.ui.get().settings, host, false)) }, t('set.ai.api.consentRevoke')),
        ),
      ),
      ...(own && !hosts.includes(own)
        ? [
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                'data-allow': own,
                onclick: () =>
                  showConfirmIn(ask, {
                    message: consentQuestion(ctx.ui.get().settings),
                    options: [{ label: t('ai.api.allow'), primary: true, run: () => cmd.setSetting(ctx, 'ai.apiConsent', consentPatch(ctx.ui.get().settings, own, true)) }],
                    cancelLabel: t('ai.api.dontAllow'),
                  }),
              },
              t('set.ai.api.consentAllow', { host: own }),
            ),
          ]
        : []),
    );
  };
  scope.watch(
    (_s, u) => [u.settings['ai.apiConsent'], u.settings['ai.apiProvider'], u.settings['ai.apiEndpoint']] as const,
    () => draw(),
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return parts.el;
}
