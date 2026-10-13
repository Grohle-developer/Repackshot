// A small XML DOM for the tests that run three's 3MF and Collada loaders in
// Node, where `DOMParser` does not exist. It implements what those loaders
// call and nothing else: elements and text nodes, attributes, `childNodes`,
// `children`, `textContent`, `getElementsByTagName(NS)` and
// `querySelector(All)` for tag names, descendant chains ("vertices vertex")
// and attribute tests (`[id="x"]`, `tag[sid="x"]`). In the browser the real
// DOMParser is used; the browser check of phase I3 runs these loaders there.

export class XNode {
  nodeType: number;
  nodeName: string;
  parentNode: XNode | null = null;
  childNodes: XNode[] = [];
  private attrs: [string, string][] = [];
  private text = '';

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
  }

  get localName(): string {
    return this.nodeName.replace(/^.*:/, '');
  }
  get tagName(): string {
    return this.nodeName;
  }
  get attributes(): { length: number; [i: number]: { name: string; value: string } } {
    const out: Record<number, { name: string; value: string }> & { length: number } = { length: this.attrs.length };
    this.attrs.forEach(([name, value], i) => (out[i] = { name, value }));
    return out;
  }
  get children(): XNode[] {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  get firstChild(): XNode | null {
    return this.childNodes[0] ?? null;
  }
  get data(): string {
    return this.text;
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.text : this.childNodes.map((c) => c.textContent).join('');
  }
  getAttribute(name: string): string | null {
    return this.attrs.find(([n]) => n === name)?.[1] ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.some(([n]) => n === name);
  }
  setAttr(name: string, value: string): void {
    this.attrs.push([name, value]);
  }
  setText(text: string): void {
    this.text = text;
  }

  private descendants(): XNode[] {
    const out: XNode[] = [];
    const walk = (n: XNode) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  getElementsByTagName(name: string): XNode[] {
    return this.descendants().filter((e) => name === '*' || e.nodeName === name);
  }
  getElementsByTagNameNS(_ns: string, name: string): XNode[] {
    return this.descendants().filter((e) => e.localName === name);
  }

  /** One compound selector (`tag`, `[a="v"]`, `tag[a="v"]`) against this element. */
  private matchesCompound(sel: string): boolean {
    const m = /^([\w:.-]*)((?:\[[^\]]+\])*)$/.exec(sel);
    if (!m) throw new Error(`dom-shim: unsupported selector "${sel}"`);
    if (m[1] && m[1] !== '*' && this.nodeName !== m[1]) return false;
    for (const a of m[2].matchAll(/\[([\w:.-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
      const v = this.getAttribute(a[1]);
      if (v === null || (a[2] !== undefined && v !== a[2])) return false;
    }
    return true;
  }
  querySelectorAll(selector: string): XNode[] {
    const chain = selector.trim().split(/\s+/);
    const all = this.descendants();
    const matches = (e: XNode, i: number): boolean => {
      if (!e.matchesCompound(chain[i])) return false;
      if (i === 0) return true;
      for (let p = e.parentNode; p; p = p.parentNode) if (p.nodeType === 1 && matches(p, i - 1)) return true;
      return false;
    };
    return all.filter((e) => matches(e, chain.length - 1));
  }
  querySelector(selector: string): XNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m)));

export class XDocument extends XNode {
  constructor() {
    super(9, '#document');
  }
  get documentElement(): XNode {
    return this.children[0];
  }
}

export function parseXml(source: string): XDocument {
  const doc = new XDocument();
  let parent: XNode = doc;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of source.matchAll(re)) {
    if (m[1] !== undefined) {
      const t = new XNode(3, '#text');
      t.setText(m[1]);
      t.parentNode = parent;
      parent.childNodes.push(t);
    } else if (m[2] !== undefined) {
      if (parent.parentNode) parent = parent.parentNode;
    } else if (m[3] !== undefined) {
      const e = new XNode(1, m[3]);
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) e.setAttr(a[1], decode(a[2] ?? a[3] ?? ''));
      e.parentNode = parent;
      parent.childNodes.push(e);
      if (m[5] !== '/') parent = e;
    } else if (m[6] !== undefined) {
      const t = new XNode(3, '#text');
      t.setText(decode(m[6]));
      t.parentNode = parent;
      parent.childNodes.push(t);
    }
  }
  return doc;
}

/** Installs `DOMParser` on the global object (idempotent). */
export function installDomShim(): void {
  const g = globalThis as unknown as { DOMParser?: unknown };
  if (g.DOMParser) return;
  g.DOMParser = class {
    parseFromString(text: string): XDocument {
      return parseXml(text);
    }
  };
}
