// Material spheres rendered in the browser (UI.md §6): a sphere with the
// material, 96 x 96, transparent background (so it sits on either theme),
// rendered with its own small renderer one per frame and cached in memory
// and in localStorage (wrapped: storage may be missing or full).

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { DOME_FLOOR, DOME_HORIZON, DOME_ZENITH } from '../data/environment';
import type { MaterialInstance } from '../core/materials';
import { applyMaterial } from './materials';

const SIZE = 96;
const STORE_PREFIX = 'repackshot.thumb.v2.';

function readCache(key: string): string | null {
  try {
    return window.localStorage.getItem(STORE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeCache(key: string, url: string): void {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, url);
  } catch {
    // Full or blocked storage: the sphere is just rendered again next time.
  }
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
    return this.queue.length;
  }

  /** Data URL of the material sphere; cached by `key`. Null when WebGL is unavailable. */
  get(mat: MaterialInstance, key: string): Promise<string | null> {
    const hit = this.memory.get(key) ?? readCache(key);
    if (hit) {
      this.memory.set(key, hit);
      return Promise.resolve(hit);
    }
    const p = this.pending.get(key);
    if (p) return p;
    const promise = new Promise<string | null>((resolve) => this.queue.push({ key, mat, resolve }));
    this.pending.set(key, promise);
    this.schedule();
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
          writeCache(job.key, url);
        }
        this.pending.delete(job.key);
        job.resolve(url);
      }
      if (this.queue.length > 0) this.schedule();
    });
  }
}
