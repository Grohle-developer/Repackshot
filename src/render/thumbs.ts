// Material spheres rendered in the browser (UI.md §6): a sphere with the
// material, 96 x 96, transparent background (so it sits on either theme),
// rendered with its own small renderer one per frame and cached in memory
// and in a `ThumbStore` the platform gives (io/platform.ts: localStorage in
// the web version, the launcher's cache folder on the desktop). A store that
// is missing, full or failing only means the sphere is rendered again.

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../data/environment';
import type { MaterialInstance } from '../core/materials';
import { applyMaterial } from './materials';

const SIZE = 96;

/** Where rendered spheres are kept between sessions, by key (a data URL each). */
export interface ThumbStore {
  /** The cached sphere, or null; a promise where the store is not in this page (the desktop launcher). */
  get(key: string): string | null | Promise<string | null>;
  /** Keeps a sphere; never throws (a full store simply keeps nothing). */
  set(key: string, url: string): void;
}

function dome(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const enc = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  for (let y = 0; y < 128; y++) {
    const el = (0.5 - (y + 0.5) / 128) * Math.PI;
    const p = 0.5 + 0.5 * Math.sin(el);
    const g = p < 0.5 ? DOME_FLOOR + (DOME_HORIZON - DOME_FLOOR) * (p / 0.5) : DOME_HORIZON + (DOME_ZENITH - DOME_HORIZON) * ((p - 0.5) / 0.5);
    const v = enc(g);
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
    ctx.fillRect(0, y, 256, 1);
  }
  return c;
}

interface Job {
  key: string;
  mat: MaterialInstance;
  resolve(url: string | null): void;
}

export class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  private readonly material = new THREE.MeshPhysicalMaterial();
  private readonly memory = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly queue: Job[] = [];
  private scheduled = false;
  /** Store reads not answered yet (they count as pending: the sphere may still need rendering). */
  private lookups = 0;

  constructor(private readonly store: ThumbStore | null = null) {}

  private init(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      RectAreaLightUniformsLib.init();
      const canvas = document.createElement('canvas');
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(SIZE, SIZE, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.1;
      const tex = new THREE.CanvasTexture(dome());
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(r);
      this.scene.environment = pmrem.fromEquirectangular(tex).texture;
      this.scene.environmentIntensity = 0.9;
      pmrem.dispose();
      const key = new THREE.RectAreaLight(0xffffff, 6, 2.2, 2.2);
      key.position.set(-2.2, 2.4, 2.6);
      key.lookAt(0, 0, 0);
      const rim = new THREE.RectAreaLight(0xffffff, 4, 3, 0.6);
      rim.position.set(2.6, 1.2, -2.2);
      rim.lookAt(0, 0, 0);
      this.scene.add(key, rim, new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material));
      this.camera.position.set(0, 0.35, 4.9);
      this.camera.lookAt(0, 0, 0);
      this.renderer = r;
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  /** Spheres waiting to be rendered. */
  pendingCount(): number {
    return this.queue.length + this.lookups;
  }

  /** Data URL of the material sphere; cached by `key`. Null when WebGL is unavailable. */
  get(mat: MaterialInstance, key: string): Promise<string | null> {
    const hit = this.memory.get(key);
    if (hit) return Promise.resolve(hit);
    const p = this.pending.get(key);
    if (p) return p;
    let stored: string | null | Promise<string | null> = null;
    try {
      stored = this.store?.get(key) ?? null;
    } catch {
      stored = null;
    }
    if (typeof stored === 'string') {
      this.memory.set(key, stored);
      return Promise.resolve(stored);
    }
    const render = () => {
      const job = new Promise<string | null>((resolve) => this.queue.push({ key, mat, resolve }));
      this.schedule();
      return job;
    };
    let promise: Promise<string | null>;
    if (stored === null) promise = render();
    else {
      this.lookups++;
      promise = stored
        .catch(() => null)
        .then((cached) => {
          this.lookups--;
          if (!cached) return render();
          this.memory.set(key, cached);
          this.pending.delete(key);
          return cached;
        });
    }
    this.pending.set(key, promise);
    return promise;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const r = this.init();
      const started = performance.now();
      // A few spheres per frame, without stalling the interface.
      while (this.queue.length > 0 && performance.now() - started < 12) {
        const job = this.queue.shift()!;
        let url: string | null = null;
        if (r) {
          applyMaterial(this.material, job.mat, 100);
          if (job.mat.family === 'EMISSIVE') this.material.emissiveIntensity = Math.min(this.material.emissiveIntensity, 2.5);
          r.setClearColor(0x000000, 0);
          r.render(this.scene, this.camera);
          url = r.domElement.toDataURL('image/png');
          this.memory.set(job.key, url);
          try {
            this.store?.set(job.key, url);
          } catch {
            // Not kept: rendered again next time.
          }
        }
        this.pending.delete(job.key);
        job.resolve(url);
      }
      if (this.queue.length > 0) this.schedule();
    });
  }
}
