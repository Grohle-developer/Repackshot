// The ways to reach a model through an API (phase X7, AI-POST.md §8.2): the generic endpoint the person describes,
// and presets for well-known services, written **only from their public API documentation** and never tried
// against the live services from here (no keys, and no network in the tests): `verified` stays false until someone
// runs one for real (◆ the lead chooses which presets ship). Stable keys: add, never rename.
//
// - Stability AI, Stable Diffusion 3.5 image-to-image: the OpenAPI document the service publishes at
//   https://api.stability.ai/v2alpha/openapi (version v2beta, read 2026-10-18), path
//   `POST /v2beta/stable-image/generate/sd3`: multipart form, `mode=image-to-image` with `image`, `strength` (0..1),
//   `seed` (0..4294967294, 0 random), `negative_prompt`, `output_format=png`, `model` (`sd3.5-large`…), the key as a
//   bearer token in `Authorization`, `Accept: application/json` for `{ image: <base64>, seed, finish_reason }`; a
//   request of at most 10 MiB, every side at least 64 px, about one megapixel.
// - OpenAI, image edits: the OpenAPI document OpenAI publishes at github.com/openai/openai-openapi (branch
//   `manual_spec`, read 2026-10-18), path `POST /v1/images/edits`: multipart form with `model=gpt-image-1`, `image`
//   (PNG, under 25 MB), `prompt` (up to 32 000 characters), `size` one of `1024x1024`, `1536x1024`, `1024x1536`; the
//   key as a bearer token; the answer `{ data: [{ b64_json }] }`. It takes no strength, seed or negative prompt: the
//   negative goes in the prompt's words, and how much changes is left to the guard (it caps every change by the
//   attempt's strength, so its retries still lower the intervention).
// - Google, Gemini image editing: the image-generation documentation at ai.google.dev (read 2026-10-19), path
//   `POST /v1beta/models/gemini-2.5-flash-image:generateContent`: JSON with `contents[0].parts` (a text part with the
//   prompt, an `inlineData` part with the PNG as base64) and `generationConfig` with `responseModalities: [TEXT, IMAGE]`
//   and `seed`; the key in `x-goog-api-key` (no `Bearer` prefix). The answer is `candidates[0].content.parts`: the
//   model usually answers text first and the image second, so the preset reads `parts.1`; when it answers the image
//   alone, the image is at `parts.0` and the response path has to change to it. The project needs the Generative
//   Language API enabled. It takes no strength or negative prompt: the negative goes in the prompt's words.
// - xAI, Grok Imagine image editing: the REST reference at docs.x.ai (read 2026-10-19), path
//   `POST /v1/images/edits`: JSON with `model=grok-imagine-image-2.0`, `prompt`, `image` as `{ url, type: image_url }`
//   (the url a data URI of the PNG) and `response_format=b64_json`; the key as a bearer token; the answer
//   `{ data: [{ b64_json }] }`. It takes no strength, seed or negative prompt: the negative goes in the prompt's
//   words. The API may answer 202 with a `request_id` (a deferred request, polled at `GET /v1/images/{request_id}`);
//   the generic endpoint makes one call and does not poll, so a deferred answer fails as `api-format`.
// - Not presets, on purpose: Together AI (its image inputs are URLs — `image_url`, `reference_images` — and the docs
//   do not say a data URI is accepted) and Ideogram (its edit answers a URL, and the endpoint only reads base64 or a
//   data URI from the answer). Both would need the endpoint to grow (an upload, a download of the answer) before a
//   preset could be written from their docs alone.

import type { Label } from './types';

/** The ways to reach a model through an API (Settings ▸ AI post-processing ▸ Model by API). Stable keys: add, never rename. */
export const API_PROVIDERS = ['GENERIC', 'STABILITY_SD3', 'OPENAI_EDIT', 'GOOGLE_GEMINI', 'XAI_IMAGINE'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const API_METHODS = ['POST', 'PUT'] as const;
export type ApiMethod = (typeof API_METHODS)[number];
/** How the request carries the image: a JSON document, or a multipart form (the image as a file part). */
export const API_BODIES = ['JSON', 'MULTIPART'] as const;
export type ApiBody = (typeof API_BODIES)[number];
/** What the service answers: a JSON document with the image in it (base64 or a data URI), or the image itself. */
export const API_RESPONSES = ['JSON', 'IMAGE'] as const;
export type ApiResponseKind = (typeof API_RESPONSES)[number];

/** One remote endpoint, as the person writes it for a generic service or as a preset gives it. No secret in it. */
export interface ApiEndpoint {
  /** `https://…`; plain `http` only to this computer (127.0.0.1, localhost, [::1]). */
  url: string;
  method: ApiMethod;
  /** The header that carries the key (`Authorization`, `X-API-Key`…); empty: the service takes no key. */
  authHeader: string;
  /** Written before the key in that header (`Bearer `). */
  authPrefix: string;
  /** More headers, none of them secret (`Accept: application/json`). */
  headers: Record<string, string>;
  body: ApiBody;
  /**
   * The body, as JSON text: an object whose strings may hold placeholders (`API_PLACEHOLDERS`, `{{prompt}}`). A string
   * that is exactly one numeric placeholder becomes a number in a JSON body. In a multipart body every key is a field,
   * and a value that is exactly `{{image}}`, `{{depth}}` or `{{edges}}` is a PNG file part.
   */
  template: string;
  response: ApiResponseKind;
  /** Where the image is in a JSON answer: keys and array indices with dots (`data.0.b64_json`). */
  responsePath: string;
  /** The longest side the service takes: a larger tile is scaled down to it (and its answer back up). */
  maxSide: number;
  /** Both sides sent are multiples of this. */
  multipleOf: number;
  /**
   * The only sizes the service makes, when it has such a list (`1024x1024`, `1536x1024`…): the tile is fitted inside
   * the one of the nearest shape, the rest filled with its edge, and only the tile's part of the answer is kept.
   * Empty: any size up to `maxSide`.
   */
  sizes: [number, number][];
}


export interface ApiPreset {
  key: ApiProvider;
  label: Label;
  /** Where its contract was read. */
  docs: string;
  /** Tried against the live service: false for every preset until someone does. */
  verified: boolean;
  /** What the service does with the pipeline's numbers. */
  takes: { strength: boolean; seed: boolean; negative: boolean };
  endpoint: ApiEndpoint;
}

/** The generic endpoint's starting point: nothing to call yet, a JSON template with every common field. */
export const GENERIC_ENDPOINT: Readonly<ApiEndpoint> = {
  url: '',
  method: 'POST',
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  headers: { Accept: 'application/json' },
  body: 'JSON',
  template: JSON.stringify(
    { image: '{{image_data_uri}}', prompt: '{{prompt}}', negative_prompt: '{{negative}}', strength: '{{strength}}', seed: '{{seed}}', width: '{{width}}', height: '{{height}}' },
    null,
    2,
  ),
  response: 'JSON',
  responsePath: 'image',
  maxSide: 1024,
  multipleOf: 16,
  sizes: [],
};

export const API_PRESETS: readonly ApiPreset[] = [
  {
    key: 'GENERIC',
    label: { en: 'Generic HTTP image-to-image', es: 'HTTP genérico de imagen a imagen' },
    docs: '',
    verified: false,
    takes: { strength: true, seed: true, negative: true },
    endpoint: GENERIC_ENDPOINT,
  },
  {
    key: 'STABILITY_SD3',
    label: { en: 'Stability AI · Stable Diffusion 3.5 (image to image)', es: 'Stability AI · Stable Diffusion 3.5 (imagen a imagen)' },
    docs: 'https://platform.stability.ai/docs/api-reference#tag/Generate/paths/~1v2beta~1stable-image~1generate~1sd3/post',
    verified: false,
    takes: { strength: true, seed: true, negative: true },
    endpoint: {
      url: 'https://api.stability.ai/v2beta/stable-image/generate/sd3',
      method: 'POST',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      headers: { Accept: 'application/json' },
      body: 'MULTIPART',
      template: JSON.stringify({
        mode: 'image-to-image',
        image: '{{image}}',
        prompt: '{{prompt}}',
        negative_prompt: '{{negative}}',
        strength: '{{strength}}',
        seed: '{{seed}}',
        model: 'sd3.5-large',
        output_format: 'png',
      }),
      response: 'JSON',
      responsePath: 'image',
      maxSide: 1024,
      multipleOf: 64,
      sizes: [],
    },
  },
  {
    key: 'OPENAI_EDIT',
    label: { en: 'OpenAI · image edits (gpt-image-1)', es: 'OpenAI · edición de imágenes (gpt-image-1)' },
    docs: 'https://platform.openai.com/docs/api-reference/images/createEdit',
    verified: false,
    takes: { strength: false, seed: false, negative: false },
    endpoint: {
      url: 'https://api.openai.com/v1/images/edits',
      method: 'POST',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      headers: {},
      body: 'MULTIPART',
      template: JSON.stringify({ model: 'gpt-image-1', image: '{{image}}', prompt: '{{prompt}} Avoid: {{negative}}', size: '{{size}}', n: '1' }),
      response: 'JSON',
      responsePath: 'data.0.b64_json',
      maxSide: 1536,
      multipleOf: 16,
      sizes: [
        [1024, 1024],
        [1536, 1024],
        [1024, 1536],
      ],
    },
  },
  {
    key: 'GOOGLE_GEMINI',
    label: { en: 'Google · Gemini image editing (gemini-2.5-flash-image)', es: 'Google · edición de imágenes con Gemini (gemini-2.5-flash-image)' },
    docs: 'https://ai.google.dev/gemini-api/docs/image-generation',
    verified: false,
    takes: { strength: false, seed: true, negative: false },
    endpoint: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      method: 'POST',
      authHeader: 'x-goog-api-key',
      authPrefix: '',
      headers: { Accept: 'application/json' },
      body: 'JSON',
      template: JSON.stringify({
        contents: [
          {
            parts: [
              { text: '{{prompt}} Avoid: {{negative}}' },
              { inlineData: { mimeType: 'image/png', data: '{{image_base64}}' } },
            ],
          },
        ],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], seed: '{{seed}}' },
      }),
      response: 'JSON',
      responsePath: 'candidates.0.content.parts.1.inlineData.data',
      maxSide: 1024,
      multipleOf: 16,
      sizes: [],
    },
  },
  {
    key: 'XAI_IMAGINE',
    label: { en: 'xAI · Grok Imagine image editing', es: 'xAI · edición de imágenes con Grok Imagine' },
    docs: 'https://docs.x.ai/developers/rest-api-reference/inference/images',
    verified: false,
    takes: { strength: false, seed: false, negative: false },
    endpoint: {
      url: 'https://api.x.ai/v1/images/edits',
      method: 'POST',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      headers: {},
      body: 'JSON',
      template: JSON.stringify({
        model: 'grok-imagine-image-2.0',
        prompt: '{{prompt}} Avoid: {{negative}}',
        image: { url: '{{image_data_uri}}', type: 'image_url' },
        response_format: 'b64_json',
      }),
      response: 'JSON',
      responsePath: 'data.0.b64_json',
      maxSide: 1024,
      multipleOf: 16,
      sizes: [],
    },
  },
];

export function apiPreset(key: ApiProvider): ApiPreset {
  return API_PRESETS.find((p) => p.key === key) ?? API_PRESETS[0];
}
