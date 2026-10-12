// Deterministic ids: a prefix plus one more than the highest numeric suffix
// already in use. Reducers stay pure (same state in, same id out).

export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** Several fresh ids at once. */
export function nextIds(prefix: string, existing: Iterable<string>, count: number): string[] {
  const taken = [...existing];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = nextId(prefix, taken);
    taken.push(id);
    out.push(id);
  }
  return out;
}
