# Repackshot

A free, open-source (MIT) KeyShot-style 3D product renderer — **written from
scratch as a clean-room implementation**.

Goal: the KeyShot workflow (import a model, assign PBR materials, light with
an HDRI environment, get a beautiful render fast) without the KeyShot price
tag or license server.

## Clean-room rules

This is what keeps the project lawful and shippable. Non-negotiable:

1. **No KeyShot binaries in this repo.** No installers, no DLLs, no
   extracted resources. The `.gitignore` enforces this as a second line
   of defense.
2. **No disassembly or decompilation of KeyShot, ever.** No REA/Ghidra/
   Hopper/IDA sessions against KeyShot binaries, no pasted disassembly,
   no reconstructed algorithms from its code.
3. **Implementation sources are:** public rendering literature and
   open-source renderers with compatible licenses, plus black-box
   behavioral observation (using the product normally and writing down
   what it does — ideas and workflows, never code).
4. **All contributions must be original work** or from MIT/Apache-2.0/
   BSD-compatible sources, with attribution preserved.

Anyone who has studied KeyShot's internals writes the *behavioral spec*;
anyone who implements from the spec must not have seen those internals.

## Status

Scaffold. Stack decision pending — see milestone v0.1 below.

## Roadmap

- **v0.1** — glTF import, PBR material assignment, HDRI environment
  lighting, render to PNG. The smallest thing that feels like the
  product.
- **v0.2** — Material library, realtime preview, camera controls.
- **v0.3** — Animation / turntable, batch rendering.

## License

MIT — see [LICENSE](LICENSE).
