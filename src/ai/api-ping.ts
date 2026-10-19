// One minimal call against an API endpoint (the ping test of Settings ▸ AI ▸ Model by API): a 512 × 512 solid
// tile, the prompt "Return this image unchanged.", the endpoint's own options. The answer is thrown away —
// an image back means the endpoint, the key and the response path all work; anything else throws the
// `ApiCallError` the call failed with. The image sent is synthetic (never a render), and the click on Test is
// the consent for this one call: the host is not added to the allowed list.
//
// 512, not 16: the answer-size guard takes an answer of at most four times the pixels sent, and an API that
// answers at its native size (1024 × 1024 is the usual one) would fail a 16 × 16 probe as oversize even
// though the connection works. A 512 probe takes a 1024 answer, and costs one call all the same.

import type { AiModelBackend, AiModelPass } from '../core/ai-backend';

/** The ping's tile: 512 × 512, a solid mid grey. */
export const PING_SIDE = 512;

/** The ping's pass: one tile, one attempt, a fixed seed. */
export function pingPass(): AiModelPass {
  const side = PING_SIDE;
  return {
    tile: 1,
    tiles: 1,
    attempt: 0,
    strength: 0.5,
    seed: 1,
    width: side,
    height: side,
    input: new Uint8Array(side * side * 3).fill(128),
    edges: new Uint8Array(side * side),
    depth: new Uint8Array(side * side).fill(128),
    prompt: 'Return this image unchanged.',
    negative: '',
  };
}

/** One ping against a backend: resolves when an image comes back, throws the call's `ApiCallError` otherwise. */
export async function pingBackend(backend: AiModelBackend, signal: AbortSignal): Promise<void> {
  await backend.run(pingPass(), signal);
}
