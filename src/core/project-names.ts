// The names a project file goes by (SPEC §3.9). The file is JSON; the extension tells it from any other JSON.

/** The extension a project is saved with. */
export const PROJECT_EXTENSION = '.repack';

/**
 * Every extension that opens as a project: the current one, and `.repack.json`, which is what the file was called
 * until v0.1.6 (those projects open the same, from a picker, a dialog or dropped on the window).
 */
export const PROJECT_EXTENSIONS: readonly string[] = [PROJECT_EXTENSION, '.repack.json'];

/** The same for a file dialog's filter: no dot, the current one first (a save dialog adds the first to a bare name). */
export const PROJECT_FILTER_EXTENSIONS: readonly string[] = PROJECT_EXTENSIONS.map((e) => e.slice(1));

/** True when the file name ends in a project extension (any case). */
export function isProjectName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROJECT_EXTENSIONS.some((e) => lower.endsWith(e) && lower.length > e.length);
}
