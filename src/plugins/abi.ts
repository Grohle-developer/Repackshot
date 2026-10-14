// ABI v1 between the host and a plugin (ROADMAP P6 decision 2, ARCHITECTURE.md §9): messages, nothing else. The
// plugin is an ES module (`plugin.js`) the host starts in a Worker from a Blob URL; it never sees the DOM or the store.
//
//   host → plugin   init     { abi, manifest, files, wasm }       once, first: its files (ArrayBuffers, transferred)
//                                                                  and its WebAssembly module's bytes (checked first)
//   plugin → host   ready    { abi }                              after init
//   host → plugin   info     { id }                               → info     { id, info: { name, version, engine? } }
//   host → plugin   presets  { id }                               → presets  { id, presets: [{ id, name, category }],
//                                                                                  categories: [{ id, label }] }
//   host → plugin   render   { id, width, height, pixels, recipe, controls }
//                                                                → render   { id, width, height, rgba8, info }
//   host → plugin   cancel   { id }                               → cancelled { id } when it had not started
//   plugin → host   error    { id, message }                      a request that failed (id null: the plugin itself)
//
// `pixels` is `linear-f32-planes` (3·w·h floats, red plane, green, blue: linear light of the working space, values
// above 1 kept) or `rgba8` (w·h·4 bytes, display-referred sRGB, straight alpha); `rgba8` comes back opaque or not, and
// the host keeps the source's alpha. Every `info` value is the plugin's own: the host shows it and invents nothing.

import type { PluginControlValue, PluginInfo, PluginManifest, PluginPixels, PluginPresets, PluginRenderInfo } from '../core/plugins';

export { cleanInfo, cleanPresets, type PluginInfo, type PluginInfoItem, type PluginPixels, type PluginPreset, type PluginPresets, type PluginRenderInfo } from '../core/plugins';

export interface RenderRequest {
  width: number;
  height: number;
  pixels: PluginPixels;
  recipe: string | null;
  controls: Record<string, PluginControlValue>;
}

export interface RenderAnswer {
  width: number;
  height: number;
  rgba8: Uint8ClampedArray;
  info: PluginRenderInfo;
}

export type HostMessage =
  | { type: 'init'; abi: 1; manifest: PluginManifest; files: Record<string, ArrayBuffer>; wasm: ArrayBuffer | null }
  | { type: 'info'; id: number }
  | { type: 'presets'; id: number }
  | ({ type: 'render'; id: number } & RenderRequest)
  | { type: 'cancel'; id: number };

export type PluginMessage =
  | { type: 'ready'; abi: number }
  | { type: 'info'; id: number; info: PluginInfo }
  | ({ type: 'presets'; id: number } & PluginPresets)
  | ({ type: 'render'; id: number } & RenderAnswer)
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number | null; message: string };
