// The render shortcuts: typing a prompt and pressing Ctrl/⌘ ⏎ must not start a render the person did not
// ask for. `render` and `renderNow` are not global, so the keyboard handler skips them while typing; the
// shortcuts themselves still exist and still work with the focus outside a field.

import { describe, expect, it } from 'vitest';
import { ACTIONS, firesWhileTyping } from '../src/ui/shortcuts';

describe('the render shortcuts while typing', () => {
  const action = (id: string) => {
    const a = ACTIONS.find((x) => x.id === id);
    expect(a, id).toBeDefined();
    return a!;
  };

  it('Render and Render now do not fire while typing in a field', () => {
    expect(firesWhileTyping(action('render'))).toBe(false);
    expect(firesWhileTyping(action('renderNow'))).toBe(false);
  });

  it('the shortcuts are still there, with the same keys', () => {
    expect(action('render').keys).toBe('mod+enter');
    expect(action('renderNow').keys).toBe('mod+shift+enter');
  });

  it('a global action still fires while typing (no overcorrection)', () => {
    expect(firesWhileTyping(action('save'))).toBe(true);
  });
});
