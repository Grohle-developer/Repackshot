// The page of the number field check (tests/number-field-browser.test.ts): the real numberField, slider and
// timeField, each writing into a real store (so the undo history is the app's), with what their onHold / onRelease
// said. The test drives them with the mouse and the keyboard and reads the store, the history and the DOM.

import { createInitialState, createStore, type ImageState } from '../../src/core/store';
import { numberField, slider, timeField, type NumberControl } from '../../src/ui/components/controls';

declare global {
  interface Window {
    nf?: {
      /** The value in the store of a field. */
      value(name: string): number;
      /** Entries of the undo history. */
      undoCount(): number;
      undo(): void;
      /** What onHold / onRelease said, in order (`hold:bounded`, `release:bounded`). */
      log: string[];
      /** How many times each field's onChange ran. */
      changes: Record<string, number>;
      set(name: string, v: number): void;
      setDisabled(name: string, v: boolean): void;
    };
    nfReady?: boolean;
  }
}

const store = createStore(createInitialState());
const host = document.getElementById('host') as HTMLElement;
const log: string[] = [];
const changes: Record<string, number> = {};
const controls = new Map<string, NumberControl>();
const keys: Record<string, keyof ImageState> = { bounded: 'exposureEv', free: 'sharpen', off: 'bloom', slider: 'vignette', time: 'contrast', labelled: 'saturation' };

const write = (name: string) => (v: number, gesture: string) => {
  changes[name] = (changes[name] ?? 0) + 1;
  store.dispatch({ type: 'image/set', patch: { [keys[name]]: v }, gesture, label: { en: `Set ${name}`, es: `Cambiar ${name}` } });
};
const hooks = (name: string) => ({ onHold: () => log.push(`hold:${name}`), onRelease: () => log.push(`release:${name}`) });
const add = (name: string, c: NumberControl) => {
  controls.set(name, c);
  const box = document.createElement('div');
  box.dataset.name = name;
  box.appendChild(c.el);
  host.appendChild(box);
};

add('bounded', numberField({ value: 0, min: -5, max: 5, step: 0.5, digits: 2, unit: 'EV', ariaLabel: 'Bounded', onChange: write('bounded'), ...hooks('bounded') }));
add('free', numberField({ value: 0, step: 1, ariaLabel: 'Free', onChange: write('free'), ...hooks('free') }));
add('off', numberField({ value: 2, min: 0, max: 10, step: 1, disabled: true, ariaLabel: 'Off', onChange: write('off'), ...hooks('off') }));
add('slider', slider({ value: 0.5, min: 0, max: 1, step: 0.1, ariaLabel: 'Slider', onChange: write('slider'), ...hooks('slider') }));
add('time', timeField(120, write('time'), 'Time'));
add('labelled', numberField({ value: 0, step: 1, label: 'X', unit: 'mm', ariaLabel: 'Labelled', onChange: write('labelled'), ...hooks('labelled') }));
// The store follows the field and the field follows the store (an undo writes the value back), as in the app.
store.subscribe((s, prev) => {
  for (const [name, c] of controls) if (s.image[keys[name]] !== prev.image[keys[name]]) c.set(s.image[keys[name]] as number);
});

window.nf = {
  value: (name) => store.get().image[keys[name]] as number,
  undoCount: () => store.history().undo.length,
  undo: () => store.undo(),
  log,
  changes,
  set: (name, v) => controls.get(name)?.set(v),
  setDisabled: (name, v) => controls.get(name)?.setDisabled(v),
};
window.nfReady = true;
