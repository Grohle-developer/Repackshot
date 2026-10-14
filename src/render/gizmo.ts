// The gizmo of the move tool (UI.md §2.3): handles to translate (arrows and
// planes), rotate (rings) and scale (cubes on the arrows, a dot in the middle
// for all three axes) a selection about its pivot, in local or global axes,
// and for a light the aim (a line to its target, with a handle at the end).
// The scale tool (phase U9) shows the same gizmo with only its scale handles:
// a shaft per axis with a larger cube at its end, and the dot in the middle.
// The preview draws it as an overlay over the render, at a constant size on
// screen, in the ink of the theme: the chrome stays achromatic, so the axes
// are told apart by their letters. Nothing here writes to the store: the drag
// is measured here and the interface turns it into actions (core/transform.ts).
//
// Everything is in model space (Z up, mm); the overlay root that holds the
// gizmo carries the same basis change as the model (preview.ts, `toThree`).

import * as THREE from 'three';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../core/math';
import type { GizmoDelta, GizmoFrame, GizmoHandle } from '../core/transform';

/** Length of an arrow on screen, CSS pixels. */
export const GIZMO_PX = 92;

/** Radius of the rotation rings, in arrow lengths. */
const RING_R = 1.3;
/** Where the scale cubes sit on the arrows. */
const CUBE_AT = 0.62;
/** Where the scale tool's cubes sit on their shafts (the end of the axis), in arrow lengths. */
export const SCALE_CUBE_AT = 0.9;

/**
 * Which handles the gizmo shows: all of the move tool's, only the scale tool's, or the move tool's without its scale
 * cubes (MOVE: a light or a camera, phase L4, which move and turn but do not scale).
 */
export type GizmoMode = 'ALL' | 'SCALE' | 'MOVE';
/** Inner and outer edge of the plane squares. */
const PLANE_LO = 0.22;
const PLANE_HI = 0.4;

/** When several handles are under the cursor, the smaller (more specific) one wins. */
const PRIORITY: Readonly<Record<GizmoHandle, number>> = { su: 0, aim: 0, sx: 1, sy: 1, sz: 1, pxy: 2, pyz: 2, pzx: 2, tx: 3, ty: 3, tz: 3, rx: 4, ry: 4, rz: 4 };

const TRANSLATE: readonly GizmoHandle[] = ['tx', 'ty', 'tz'];
const ROTATE: readonly GizmoHandle[] = ['rx', 'ry', 'rz'];
const SCALE: readonly GizmoHandle[] = ['sx', 'sy', 'sz'];
const PLANES: readonly [GizmoHandle, number, number][] = [
  ['pxy', 0, 1],
  ['pyz', 1, 2],
  ['pzx', 2, 0],
];
const UNIT = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const LETTERS = ['X', 'Y', 'Z'];

/** A ray in model space; `dir` has unit length. */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

// ---------------------------------------------------------------------------
// Drag math (pure)
// ---------------------------------------------------------------------------

/** Parameter of the point of the line `origin + t * axis` closest to a ray; null when they are parallel. */
export function axisParam(origin: Vec3, axis: Vec3, ray: Ray): number | null {
  const w0 = sub(origin, ray.origin);
  const b = dot(axis, ray.dir);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  return (b * dot(ray.dir, w0) - dot(axis, w0)) / denom;
}

/** Where a ray meets the plane through `point` with `normal`; null when it runs along it. */
export function planeHit(point: Vec3, normal: Vec3, ray: Ray): Vec3 | null {
  const den = dot(ray.dir, normal);
  if (Math.abs(den) < 1e-6) return null;
  return add(ray.origin, scale(ray.dir, dot(sub(point, ray.origin), normal) / den));
}

const clampFactor = (f: number) => Math.max(0.01, Math.min(100, f));
const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * One drag of a handle: measures, from where it began, how far the pointer took it. Translations come in
 * mm along the frame's axes, rotations in degrees, scales as factors; nothing is snapped here.
 */
export class GizmoDrag {
  private lastAngle = 0;
  private totalAngle = 0;
  private readonly t0: number | null;
  private readonly p0: Vec3 | null;

  /**
   * @param size world length of an arrow when the drag began (mm)
   * @param view direction the camera looks along, model space
   * @param aimTarget the light's target, for the aim handle
   * @param scaleReach the scale tool: how far along an axis (in arrow lengths) the pointer goes to double the scale,
   *   wherever the shaft was grabbed; without it, the factor is the ratio of the distances from the pivot
   */
  constructor(
    readonly handle: GizmoHandle,
    readonly frame: GizmoFrame,
    private readonly size: number,
    start: Ray,
    private readonly startPx: { x: number; y: number },
    private readonly view: Vec3,
    private readonly aimTarget: Vec3 | null = null,
    private readonly scaleReach: number | null = null,
  ) {
    const { origin, axes } = frame;
    const k = this.axis();
    if (handle === 'aim') {
      this.t0 = null;
      this.p0 = aimTarget ? planeHit(aimTarget, view, start) : null;
    } else if (handle.startsWith('p')) {
      this.t0 = null;
      const [, i, j] = PLANES.find((p) => p[0] === handle)!;
      this.p0 = planeHit(origin, cross(axes[i], axes[j]), start);
    } else if (handle.startsWith('r')) {
      this.t0 = null;
      this.p0 = Math.abs(dot(start.dir, axes[k])) > 0.15 ? planeHit(origin, axes[k], start) : null;
    } else if (handle === 'su') {
      this.t0 = null;
      this.p0 = null;
    } else {
      this.t0 = axisParam(origin, axes[k], start);
      this.p0 = null;
    }
  }

  private axis(): 0 | 1 | 2 {
    const c = this.handle[this.handle.length - 1];
    return c === 'x' ? 0 : c === 'y' ? 1 : 2;
  }

  /** The drag so far for the pointer at `ray` (and `px`, CSS pixels on the canvas). */
  update(ray: Ray, px: { x: number; y: number }): GizmoDelta {
    const { origin, axes } = this.frame;
    const k = this.axis();
    const dx = px.x - this.startPx.x;
    const dy = px.y - this.startPx.y;
    const perPx = this.size / GIZMO_PX;
    const h = this.handle;
    if (h === 'aim') {
      const target = this.aimTarget ?? origin;
      const p1 = this.p0 ? planeHit(target, this.view, ray) : null;
      return { kind: 'aim', target: this.p0 && p1 ? add(target, sub(p1, this.p0)) : target };
    }
    if (h.startsWith('t')) {
      const t = this.t0 === null ? null : axisParam(origin, axes[k], ray);
      const amounts: Vec3 = [0, 0, 0];
      // Along the view the axis cannot be followed on screen: the vertical motion of the pointer moves it.
      amounts[k] = this.t0 !== null && t !== null ? t - this.t0 : -dy * perPx;
      return { kind: 'move', amounts };
    }
    if (h.startsWith('p')) {
      const [, i, j] = PLANES.find((p) => p[0] === h)!;
      const p1 = this.p0 ? planeHit(origin, cross(axes[i], axes[j]), ray) : null;
      const amounts: Vec3 = [0, 0, 0];
      if (this.p0 && p1) {
        const d = sub(p1, this.p0);
        amounts[i] = dot(d, axes[i]);
        amounts[j] = dot(d, axes[j]);
      }
      return { kind: 'move', amounts };
    }
    if (h.startsWith('r')) {
      const p1 = this.p0 ? planeHit(origin, axes[k], ray) : null;
      if (!this.p0 || !p1) return { kind: 'rotate', axis: k, deg: dx * 0.5 };
      const v0 = sub(this.p0, origin);
      const v1 = sub(p1, origin);
      const angle = (Math.atan2(dot(axes[k], cross(v0, v1)), dot(v0, v1)) * 180) / Math.PI;
      // Unwrapped, so a drag can go past half a turn.
      this.totalAngle += wrap180(angle - this.lastAngle);
      this.lastAngle = angle;
      return { kind: 'rotate', axis: k, deg: this.totalAngle };
    }
    const screen = clampFactor(Math.pow(2, (dx - dy) / 120));
    if (h === 'su') return { kind: 'scale', factors: [screen, screen, screen] };
    const t = this.t0 === null ? null : axisParam(origin, axes[k], ray);
    const factors: Vec3 = [1, 1, 1];
    const along = this.t0 !== null && t !== null && Math.abs(this.t0) > this.size * 0.05;
    factors[k] = !along ? screen : this.scaleReach ? clampFactor(1 + ((t! - this.t0!) * Math.sign(this.t0!)) / (this.scaleReach * this.size)) : clampFactor(t! / this.t0!);
    return { kind: 'scale', factors };
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** A geometry built along +Y and centred on 0, moved to span `from..to` along `axis`. */
function along(geo: THREE.BufferGeometry, axis: number, from: number, to: number): THREE.BufferGeometry {
  geo.translate(0, (from + to) / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UNIT[1], UNIT[axis]));
  return geo;
}

function cylinder(radius: number, axis: number, from: number, to: number, segments = 10): THREE.BufferGeometry {
  return along(new THREE.CylinderGeometry(radius, radius, to - from, segments, 1), axis, from, to);
}

function cone(radius: number, axis: number, from: number, to: number): THREE.BufferGeometry {
  return along(new THREE.ConeGeometry(radius, to - from, 16, 1), axis, from, to);
}

/** A ring about `axis` (a torus lies in XY, about Z). */
function ring(radius: number, tube: number, axis: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 6, 96);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UNIT[2], UNIT[axis]));
  return g;
}

/** A square in the plane of axes i and j. */
function square(i: number, j: number, lo: number, hi: number): THREE.BufferGeometry {
  const corner = (a: number, b: number) => {
    const v = [0, 0, 0];
    v[i] = a;
    v[j] = b;
    return v;
  };
  const p = [corner(lo, lo), corner(hi, lo), corner(hi, hi), corner(lo, hi)].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function cube(size: number, axis: number, at: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size);
  const v = [0, 0, 0];
  v[axis] = at;
  g.translate(v[0], v[1], v[2]);
  return g;
}

function letterTexture(letter: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 40px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface HandleParts {
  id: GizmoHandle;
  /** The tool whose gizmo has this handle (MOVE shows the handles of ALL but its scale ones). */
  mode: 'ALL' | 'SCALE' | 'AIM';
  /** Drawn in ink. */
  solid: THREE.MeshBasicMaterial;
  /** Translucent fill (plane squares). */
  fill: boolean;
  /** Invisible, larger shape for picking. */
  hit: THREE.Mesh[];
  objects: THREE.Object3D[];
}

const overlayMaterial = (opacity: number): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });

export class Gizmo {
  /** Model space; add it under a group with the model's basis change. */
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly aimGroup = new THREE.Group();
  private readonly aimHandle = new THREE.Group();
  private readonly aimLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly handles: HandleParts[] = [];
  private readonly groups: Record<'ALL' | 'SCALE', THREE.Group> = { ALL: new THREE.Group(), SCALE: new THREE.Group() };
  private mode: GizmoMode = 'ALL';
  private readonly halo = overlayMaterial(0.4);
  private readonly hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly labels: THREE.Sprite[] = [];
  private current: GizmoFrame | null = null;
  private aim: { from: Vec3; target: Vec3 } | null = null;
  private size = 1;
  /** Settings ▸ Preferences ▸ Gizmo size: a factor of the on-screen size (the drag maths do not change). */
  private scale = 1;
  private hover: GizmoHandle | null = null;
  private active: GizmoHandle | null = null;

  constructor() {
    this.root.visible = false;
    this.body.matrixAutoUpdate = false;
    this.aimHandle.matrixAutoUpdate = true;
    this.root.add(this.body, this.aimGroup);
    this.body.add(this.groups.ALL, this.groups.SCALE);
    this.groups.SCALE.visible = false;
    for (let k = 0; k < 3; k++) {
      this.add(TRANSLATE[k], [cylinder(0.014, k, 0.14, 0.84), cone(0.055, k, 0.82, 1)], [cylinder(0.075, k, 0.1, 1.05)], [cylinder(0.032, k, 0.14, 0.84)]);
      this.add(SCALE[k], [cube(0.085, k, CUBE_AT)], [cube(0.15, k, CUBE_AT)], [cube(0.115, k, CUBE_AT)]);
      this.add(ROTATE[k], [ring(RING_R, 0.011, k)], [ring(RING_R, 0.07, k)], [ring(RING_R, 0.028, k)]);
      // The scale tool: a shaft to a larger cube at the end of the axis; the whole shaft grabs.
      this.add(SCALE[k], [cylinder(0.014, k, 0.12, SCALE_CUBE_AT - 0.05), cube(0.11, k, SCALE_CUBE_AT)], [cylinder(0.06, k, 0.12, SCALE_CUBE_AT), cube(0.19, k, SCALE_CUBE_AT)], [cylinder(0.032, k, 0.12, SCALE_CUBE_AT - 0.05), cube(0.145, k, SCALE_CUBE_AT)], false, 'SCALE');
    }
    for (const [id, i, j] of PLANES) this.add(id, [square(i, j, PLANE_LO, PLANE_HI)], [square(i, j, PLANE_LO - 0.02, PLANE_HI + 0.02)], [], true);
    this.add('su', [new THREE.SphereGeometry(0.05, 16, 12)], [new THREE.SphereGeometry(0.1, 8, 6)], [new THREE.SphereGeometry(0.075, 16, 12)]);
    this.add('su', [new THREE.SphereGeometry(0.075, 20, 14)], [new THREE.SphereGeometry(0.14, 10, 8)], [new THREE.SphereGeometry(0.105, 20, 14)], false, 'SCALE');
    for (let k = 0; k < 3; k++) {
      const map = letterTexture(LETTERS[k]);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      const v = [0, 0, 0];
      v[k] = 1.16;
      sprite.position.set(v[0], v[1], v[2]);
      sprite.scale.set(0.2, 0.2, 1);
      sprite.renderOrder = 3;
      this.labels.push(sprite);
      this.body.add(sprite);
    }
    // The aim of a light: a line from the light to its target and a handle there.
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7, depthTest: false, depthWrite: false, toneMapped: false }));
    this.aimLine.renderOrder = 1;
    const aimSolid = overlayMaterial(0.8);
    const aimVisual = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), aimSolid);
    const aimHalo = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), this.halo);
    const aimHit = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.hitMaterial);
    aimHit.userData.handle = 'aim';
    aimVisual.renderOrder = 2;
    aimHalo.renderOrder = 1;
    this.aimHandle.add(aimHalo, aimVisual, aimHit);
    this.aimGroup.add(this.aimLine, this.aimHandle);
    this.handles.push({ id: 'aim', mode: 'AIM', solid: aimSolid, fill: false, hit: [aimHit], objects: [aimHalo, aimVisual] });
    this.look();
  }

  private add(id: GizmoHandle, visual: THREE.BufferGeometry[], hit: THREE.BufferGeometry[], halo: THREE.BufferGeometry[], fill = false, mode: 'ALL' | 'SCALE' = 'ALL'): void {
    const solid = overlayMaterial(fill ? 0.3 : 0.8);
    const objects: THREE.Object3D[] = [];
    for (const g of halo) {
      const m = new THREE.Mesh(g, this.halo);
      m.renderOrder = 1;
      objects.push(m);
    }
    for (const g of visual) {
      const m = new THREE.Mesh(g, solid);
      m.renderOrder = 2;
      objects.push(m);
    }
    const hits = hit.map((g) => {
      const m = new THREE.Mesh(g, this.hitMaterial);
      m.userData.handle = id;
      return m;
    });
    this.groups[mode].add(...objects, ...hits);
    this.handles.push({ id, mode, solid, fill, hit: hits, objects });
  }

  /** The handles the gizmo shows and picks: the move tool's (ALL) or the scale tool's (SCALE). */
  setMode(mode: GizmoMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.groups.ALL.visible = mode !== 'SCALE';
    this.groups.SCALE.visible = mode === 'SCALE';
    // A light or a camera: the scale cubes of the move tool go.
    for (const h of this.handles) {
      if (h.mode !== 'ALL' || !h.id.startsWith('s')) continue;
      for (const o of [...h.objects, ...h.hit]) o.visible = mode === 'ALL';
    }
    this.hover = null;
    this.active = null;
    this.look();
  }

  get handleMode(): GizmoMode {
    return this.mode;
  }

  /** Ink of the handles (the theme's --ink-0, linear); the halo is the opposite grey. */
  setInk(rgb: readonly number[]): void {
    const halo = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.5 ? 0 : 1;
    for (const h of this.handles) h.solid.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
    for (const l of this.labels) l.material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
    this.aimLine.material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
    this.halo.color.setRGB(halo, halo, halo, THREE.LinearSRGBColorSpace);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  get frame(): GizmoFrame | null {
    return this.current;
  }

  get aimTarget(): Vec3 | null {
    return this.aim?.target ?? null;
  }

  /** World length of an arrow right now (mm). */
  get worldSize(): number {
    return this.size;
  }

  /** The arrow's world length at the factory size: what a drag measures against. */
  get baseWorldSize(): number {
    return this.size / this.scale;
  }

  setScale(k: number): void {
    this.scale = Math.max(0.25, Math.min(4, k));
  }

  /** Places the gizmo on a frame (null hides it); `aim` adds the aim handle of a light. */
  place(frame: GizmoFrame | null, aim: { from: Vec3; target: Vec3 } | null): void {
    this.current = frame;
    this.aim = frame ? aim : null;
    this.root.visible = frame !== null;
    this.aimGroup.visible = this.aim !== null;
    if (this.aim) {
      this.aimLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([...this.aim.from, ...this.aim.target], 3));
      this.aimLine.geometry.attributes.position.needsUpdate = true;
      this.aimHandle.position.set(this.aim.target[0], this.aim.target[1], this.aim.target[2]);
    }
    this.compose();
  }

  /** Keeps the handles the same size on screen: world units per CSS pixel at the origin and at the aim target. */
  setPixelSize(atOrigin: number, atTarget: number): void {
    this.size = Math.max(1e-9, atOrigin * GIZMO_PX * this.scale);
    const s = Math.max(1e-9, atTarget * GIZMO_PX * this.scale);
    this.aimHandle.scale.set(s, s, s);
    this.compose();
  }

  private compose(): void {
    const f = this.current;
    if (!f) return;
    const [x, y, z] = f.axes.map((a) => new THREE.Vector3(a[0], a[1], a[2]));
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    m.scale(new THREE.Vector3(this.size, this.size, this.size));
    m.setPosition(f.origin[0], f.origin[1], f.origin[2]);
    this.body.matrix.copy(m);
    this.body.matrixWorldNeedsUpdate = true;
  }

  /** The handle a ray hits (three.js world space, as the raycaster has it). */
  pick(raycaster: THREE.Raycaster): GizmoHandle | null {
    if (!this.root.visible) return null;
    this.root.updateMatrixWorld(true);
    const targets: THREE.Object3D[] = [];
    for (const h of this.handles) if (this.shows(h) || (h.mode === 'AIM' && this.aim)) targets.push(...h.hit);
    let best: { id: GizmoHandle; d: number } | null = null;
    for (const hit of raycaster.intersectObjects(targets, false)) {
      const id = hit.object.userData.handle as GizmoHandle;
      if (!best || PRIORITY[id] < PRIORITY[best.id] || (PRIORITY[id] === PRIORITY[best.id] && hit.distance < best.d)) best = { id, d: hit.distance };
    }
    return best?.id ?? null;
  }

  /** Whether the handles of the current mode include this one. */
  private shows(h: HandleParts): boolean {
    if (this.mode === 'MOVE') return h.mode === 'ALL' && !h.id.startsWith('s');
    return h.mode === this.mode;
  }

  /** Highlights a handle under the cursor; true when that changed. */
  setHover(id: GizmoHandle | null): boolean {
    if (id === this.hover) return false;
    this.hover = id;
    this.look();
    return true;
  }

  /** The handle being dragged (the others dim). */
  setActive(id: GizmoHandle | null): void {
    this.active = id;
    this.look();
  }

  private look(): void {
    for (const h of this.handles) {
      const id = h.id;
      const on = this.active ? id === this.active : id === this.hover;
      const dim = this.active !== null && id !== this.active;
      h.solid.opacity = h.fill ? (on ? 0.6 : dim ? 0.06 : 0.3) : on ? 1 : dim ? 0.16 : 0.62;
      // The halo of the highlighted handle thickens its outline (a hidden scale cube keeps its halo hidden).
      const hidden = this.mode === 'MOVE' && h.mode === 'ALL' && id.startsWith('s');
      for (const o of h.objects) if (o instanceof THREE.Mesh && o.material === this.halo) o.visible = !dim && !hidden;
    }
    for (const l of this.labels) l.material.opacity = this.active ? 0.3 : 0.9;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
    });
    for (const h of this.handles) h.solid.dispose();
    this.halo.dispose();
    this.hitMaterial.dispose();
    for (const l of this.labels) {
      l.material.map?.dispose();
      l.material.dispose();
    }
  }
}

/** A ray from the camera through a point of the viewport, in model space. `toModel` undoes the basis change. */
export function modelRay(raycaster: THREE.Raycaster, toModel: (v: THREE.Vector3) => Vec3): Ray {
  const o = toModel(raycaster.ray.origin);
  const d = normalize(toModel(raycaster.ray.direction));
  return { origin: o, dir: d };
}
