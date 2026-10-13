// The service of a build without an AI pipeline (before X3c connects the desktop one and X3d the web one):
// it says so (`NOT_BUILT`), the render window shows the switch as "coming soon", and nothing ever calls `post`.

import type { AiPostService, AiRuntimeStatus } from '../core/ai';

export const notBuiltService: AiPostService = {
  async status(): Promise<AiRuntimeStatus> {
    return { available: false, reason: 'NOT_BUILT', backend: null, device: null, supports: [], activeModel: null };
  },
  async post() {
    throw new Error('AI post-processing is not built into this version yet');
  },
};
