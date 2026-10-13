// Output names from a template with tokens (UI.md §2.7): `{project}`,
// `{camera}`, `{studio}`, `{date}`, `{n}`. The token keys are stable (the
// interface shows them with localised chip labels) and are the same in every
// language, so a template saved in a project means the same everywhere.

export const NAME_TOKENS = ['project', 'camera', 'studio', 'date', 'n'] as const;
export type NameToken = (typeof NAME_TOKENS)[number];

/** The template a new project starts with: "Bottle_Camera 1_0001". */
export const DEFAULT_NAME_TEMPLATE = '{project}_{camera}_{n}';

export interface NameValues {
  project: string;
  camera: string;
  studio: string;
  /** The day the image is written. */
  date: Date;
  /** The render number of an image, or the frame number of a frame of an animation. */
  n: number;
}

/** Digits of `{n}` and of frame numbers: 0001. */
export const NUMBER_DIGITS = 4;

export function padNumber(n: number, digits = NUMBER_DIGITS): string {
  const v = Math.max(0, Math.floor(n));
  return String(v).padStart(digits, '0');
}

/** `YYYY-MM-DD` in local time (what the person reads on their calendar). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The template with every known token replaced; unknown `{words}` stay as typed. */
export function expandTemplate(template: string, v: NameValues): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => {
    switch (key as NameToken) {
      case 'project':
        return v.project;
      case 'camera':
        return v.camera;
      case 'studio':
        return v.studio;
      case 'date':
        return isoDate(v.date);
      case 'n':
        return padNumber(v.n);
      default:
        return m;
    }
  });
}

/** Whether a template numbers its outputs (frames of an animation need a number). */
export function hasNumberToken(template: string): boolean {
  return template.includes('{n}');
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/** Characters no file system takes (Windows is the strictest), and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
/** Longest base name kept (file systems allow 255 bytes; room for the extension and a copy suffix). */
export const MAX_NAME_LENGTH = 150;

/**
 * A name any file system accepts: unsafe characters removed, runs of white space collapsed,
 * no leading or trailing dots or spaces, no reserved device names, at most 150 characters, and
 * `fallback` when nothing is left.
 */
export function safeFileName(name: string, fallback = 'render'): string {
  let s = name.replace(UNSAFE, '').replace(/\s+/g, ' ');
  s = s.replace(/^[\s.]+|[\s.]+$/g, '');
  if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH).replace(/[\s.]+$/g, '');
  if (!s) return fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/**
 * The file name of an output: the template expanded and made safe, plus the extension. Frames of
 * an animation get their number through `{n}`, appended as `_0001` when the template has none,
 * so a sequence never overwrites itself.
 */
export function outputFileName(template: string, v: NameValues, ext: string, frame = false): string {
  if (frame && !hasNumberToken(template)) return `${safeFileName(expandTemplate(template, v))}_${padNumber(v.n)}.${ext}`;
  return `${safeFileName(expandTemplate(template, v))}.${ext}`;
}
