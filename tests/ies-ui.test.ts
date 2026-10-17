// Phase L5, the commands behind Add light ▸ IES…, Change… and the drop of a .ies file on the window: a profile the reader accepts
// becomes a light (one undo entry, the Lights tab in front), one it refuses adds nothing and the toast says why, in both languages;
// the menu and the palette have the entry live; the strings of every refusal exist in both languages with their numbers.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { IES_MAX_BYTES, iesTextOf, parseIes, type IesErrorCode } from '../src/core/ies';
import { createStore, type ProjectState } from '../src/core/store';
import * as cmd from '../src/ui/commands';
import { lightMenuItems } from '../src/ui/panels/add-menu';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { actionById } from '../src/ui/shortcuts';
import { setLang, STRINGS, t, type StringKey } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState } from './helpers';

afterEach(() => setLang('en'));

const read = (name: string): string => iesTextOf(new Uint8Array(readFileSync(`tests/fixtures/ies/${name}`)));
const DOWNLIGHT = read('downlight-symmetric.ies');
const WALL_WASHER = read('wall-washer.ies');
const file = (text: string, name: string): File => new File([Uint8Array.from(text, (c) => c.charCodeAt(0) & 255)], name);

function makeCtx(state: ProjectState = exampleState()): { ctx: Ctx; imported: string[] } {
  const imported: string[] = [];
  const services = {
    viewport: null,
    importFile: async (f: File) => {
      imported.push(f.name);
      throw new Error('stub');
    },
  } as unknown as AppServices;
  return { ctx: { store: createStore(state), ui: createUiStore(), services }, imported };
}

const toasts = (ctx: Ctx) => ctx.ui.get().toasts.map((x) => x.text);
const lights = (ctx: Ctx) => ctx.store.get().studio.lights;
const last = (ctx: Ctx) => lights(ctx)[lights(ctx).length - 1];

describe('Add light ▸ IES…', () => {
  it('a profile file becomes a light, named by the file, selected, on the Lights tab, in one undo step', async () => {
    const { ctx } = makeCtx();
    const n = lights(ctx).length;
    expect(await cmd.addIesLight(ctx, file(WALL_WASHER, 'washer.ies'))).toBe(true);
    expect(lights(ctx)).toHaveLength(n + 1);
    expect(last(ctx)).toMatchObject({ type: 'IES', own: true });
    expect(last(ctx).ies!.name).toBe('Test wall washer, asymmetric (all 360 degrees given)');
    // The text is the file's, byte for byte (one character per byte).
    expect(last(ctx).ies!.text).toBe(WALL_WASHER);
    expect(ctx.store.get().selection.ids).toEqual([last(ctx).id]);
    expect(ctx.ui.get().sceneTab).toBe('lights');
    expect(ctx.store.history().undo).toEqual(['Add IES light Test wall washer, asymmetric (all 360 degrees given)']);
    expect(STRINGS.es['undo.addIesLight']).toBe('Añadir foco IES {name}');
    ctx.store.undo();
    expect(lights(ctx)).toHaveLength(n);
  });

  it('a file whose profile has no description is named by its file', async () => {
    const { ctx } = makeCtx();
    const bare = 'TILT=NONE\n1 1000 1 2 1 1 2 0 0 0\n1 1 10\n0 90\n0\n100 100\n';
    await cmd.addIesLight(ctx, file(bare, 'Strip light.IES'));
    expect(last(ctx).ies!.name).toBe('Strip light');
  });

  it('a file the reader refuses adds nothing and the toast says why, in the language of the interface', async () => {
    for (const [lang, want] of [
      ['en', 'bad.ies has TILT=INCLUDE, a tilt table that is not read: export the profile with TILT=NONE'],
      ['es', 'bad.ies lleva TILT=INCLUDE, una tabla de inclinación que no se lee: exporta el perfil con TILT=NONE'],
    ] as const) {
      setLang(lang);
      const { ctx } = makeCtx();
      const n = lights(ctx).length;
      expect(await cmd.addIesLight(ctx, file(DOWNLIGHT.replace('TILT=NONE', 'TILT=INCLUDE'), 'bad.ies'))).toBe(false);
      expect(lights(ctx)).toHaveLength(n);
      expect(toasts(ctx)).toEqual([want]);
      expect(ctx.store.history().undo).toHaveLength(0);
    }
  });

  it('says the numbers of a cut file and the type of one of photometry B', async () => {
    const { ctx } = makeCtx();
    await cmd.addIesLight(ctx, file(DOWNLIGHT.replace('1000 970 883 750 587 413 250 117 30 0', '1000 970'), 'cut.ies'));
    await cmd.addIesLight(ctx, file(DOWNLIGHT.replace('1 2094 1 10 1 1 2', '1 2094 1 10 1 2 2'), 'b.ies'));
    expect(toasts(ctx)).toEqual([
      'cut.ies is cut short: its counts call for 34 numbers after TILT=NONE and it has 26',
      'b.ies is photometric type B: only type C is read; export it as type C',
    ]);
  });

  it('a file that is too large is refused before it is read', async () => {
    const { ctx } = makeCtx();
    expect(await cmd.addIesLight(ctx, file(' '.repeat(IES_MAX_BYTES + 1), 'huge.ies'))).toBe(false);
    expect(toasts(ctx)).toEqual(['huge.ies is too large to be an IES profile (2 MB at most)']);
  });

  it('every refusal of the reader has its sentence in both languages, with the numbers it needs', () => {
    const codes: IesErrorCode[] = ['TooLarge', 'MissingTilt', 'TiltIncluded', 'TiltFile', 'NotANumber', 'ShortHeader', 'BadCount', 'TooManyAngles', 'UnsupportedType', 'BadType', 'BadMultiplier', 'Truncated', 'TooManyValues', 'BadVerticalAngles', 'BadHorizontalAngles', 'NegativeCandela', 'NoLight'];
    for (const code of codes) {
      const key = `ies.error.${code}` as StringKey;
      expect(STRINGS.en[key], key).toBeTruthy();
      expect(STRINGS.es[key], key).toBeTruthy();
      expect(STRINGS.en[key]).toContain('{name}');
    }
    // The refusals that carry numbers are the ones of the reader.
    const refusal = parseIes(DOWNLIGHT.replace('1000 970 883', '1000 x 883'));
    expect(!refusal.ok && cmd.iesErrorText('f.ies', refusal.error)).toBe('f.ies: value 26 of the table is not a number');
  });

  it('is in the menu as a live entry (no longer coming soon) and in the palette', () => {
    const { ctx } = makeCtx();
    const items = lightMenuItems(ctx);
    const entry = items.find((i) => i !== null && 'label' in i && i.label === t('lights.addKind.IES'));
    expect(entry && 'disabled' in entry ? entry.disabled : undefined).toBeFalsy();
    expect(entry && 'run' in entry ? typeof entry.run : null).toBe('function');
    expect(t('lights.addKind.IES')).toBe('IES…');
    expect(actionById('addLight.IES')).toBeDefined();
    expect(STRINGS.en['lights.addAction.IES']).toBe('Add light: IES profile…');
    expect(STRINGS.es['lights.addAction.IES']).toBe('Añadir luz: perfil IES…');
    // The words "coming soon" are gone from the entry's tooltip.
    expect(STRINGS.en['lights.addTip.IES']).not.toMatch(/soon|phase/i);
    expect(STRINGS.es['lights.addTip.IES']).not.toMatch(/pr[óo]ximamente|fase/i);
  });
});

describe('Change…', () => {
  it('another file for the same light keeps its place and its level, in one undo step', async () => {
    const { ctx } = makeCtx();
    await cmd.addIesLight(ctx, file(WALL_WASHER, 'a.ies'));
    const id = last(ctx).id;
    ctx.store.dispatch({ type: 'studio/setLight', id, patch: { power: last(ctx).power * 4, az: 33 }, label: { en: 'x', es: 'x' } });
    const before = last(ctx);
    expect(await cmd.replaceIesProfile(ctx, id, file(DOWNLIGHT, 'b.ies'))).toBe(true);
    const after = last(ctx);
    expect(after.ies!.text).toBe(DOWNLIGHT);
    expect(after.ies!.name).toBe('Test downlight, 1000 cd cos^2, rotationally symmetric');
    // Same light: place, power and base (so the multiplier stays ×4).
    expect([after.id, after.az, after.power, after.ies!.base]).toEqual([id, 33, before.power, before.ies!.base]);
    expect(ctx.store.history().undo[0]).toBe('Change the IES profile of IES');
    ctx.store.undo();
    expect(last(ctx).ies!.text).toBe(WALL_WASHER);
  });

  it('a refused file changes nothing', async () => {
    const { ctx } = makeCtx();
    await cmd.addIesLight(ctx, file(WALL_WASHER, 'a.ies'));
    const before = last(ctx);
    expect(await cmd.replaceIesProfile(ctx, before.id, file('nope', 'b.ies'))).toBe(false);
    expect(last(ctx)).toBe(before);
    expect(toasts(ctx)).toEqual(['b.ies is not an IES file: it has no TILT= line']);
    expect(await cmd.replaceIesProfile(ctx, 'nobody', file(DOWNLIGHT, 'c.ies'))).toBe(false);
  });
});

describe('dropping a .ies file on the window', () => {
  it('adds the light and imports nothing; the other files go to the importers as before', async () => {
    const { ctx, imported } = makeCtx();
    const n = lights(ctx).length;
    cmd.dropFiles(ctx, [file(WALL_WASHER, 'x.IES'), file('v 0 0 0', 'a.obj')]);
    await new Promise((r) => setTimeout(r, 30));
    expect(lights(ctx)).toHaveLength(n + 1);
    expect(last(ctx).type).toBe('IES');
    expect(imported).toEqual(['a.obj']);
    expect(cmd.isIesFile(file('', 'lamp.ies'))).toBe(true);
    expect(cmd.isIesFile(file('', 'lamp.iesx'))).toBe(false);
    expect(cmd.isIesFile(file('', 'part.step'))).toBe(false);
  });

  it('a .ies that is refused says why and goes nowhere else', async () => {
    const { ctx, imported } = makeCtx();
    const n = lights(ctx).length;
    cmd.dropFiles(ctx, [file('garbage', 'x.ies')]);
    await new Promise((r) => setTimeout(r, 30));
    expect(lights(ctx)).toHaveLength(n);
    expect(imported).toEqual([]);
    expect(toasts(ctx)).toHaveLength(1);
  });
});
