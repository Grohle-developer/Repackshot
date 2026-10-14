// Installing a new version from inside the desktop application (phase P5): the page's side of the launcher's
// `/api/update/*` (engine/crates/rt-app/src/update/, the contract is in that crate's README). The launcher
// downloads the package of the release and its SHA256SUMS.txt, checks the sum, installs and waits for the window to
// close; the page asks, follows `GET /api/update` and closes the window when the launcher says it is ready
// (ui/updates.ts). Nothing here decides what may be downloaded: ui/updates.ts only asks for the feed's own
// release downloads (core/updates.ts), and the launcher checks again.

import { parseInstallStatus, type InstallerPort, type InstallRequest, type InstallStatus } from '../core/updates';
import { NativeError, type NativeClient } from './native';

export class NativeInstaller implements InstallerPort {
  constructor(private readonly native: NativeClient) {}

  private read(raw: unknown): InstallStatus {
    const status = parseInstallStatus(raw);
    if (!status) throw new NativeError(502, 'bad-answer', 'the launcher answered with something that is not an update status');
    return status;
  }

  async status(): Promise<InstallStatus> {
    return this.read(await this.native.updateStatus());
  }

  async install(req: InstallRequest): Promise<InstallStatus> {
    return this.read(await this.native.updateInstall(req));
  }

  async cancel(): Promise<InstallStatus> {
    return this.read(await this.native.updateCancel());
  }
}
