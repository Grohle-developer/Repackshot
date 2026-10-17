# Contributing to Repackshot

Repackshot is a clean-room, browser-based 3D product renderer, source-available
under the PolyForm Noncommercial License 1.0.0.
Read this before you open a pull request.

## Clean-room rules

- No KeyShot binaries. Do not install, unpack, or copy from them.
- No disassembly. No decompiling, reverse engineering, or tracing of their code or formats.
- Sources are limited to public literature, compatible-licence open source, and black-box observation of behaviour.

## Before touching anything

```sh
npm ci              # install exact dependencies from the lockfile
npm run qa          # type check, tests and build
npm run screenshot  # render the UI to out/screenshot.png
```

## Where things live

- `CLAUDE.md`: entry point for agents and humans.
- `docs/ROADMAP.md`: phases and owners.
- `docs/SPEC.md`: what the product does.
- `docs/ARCHITECTURE.md`: stack and module boundaries.
- `docs/UI.md`: interface spec.

## Work rules

1. One roadmap phase per PR.
2. No change ships without the suite green.
3. Every fixed bug carries a regression test, verified to fail without the fix.
4. Code, identifiers and comments in English. Docs in Spanish. UI strings in both `es` and `en`.
5. The UI chrome is strictly black and white.
6. Keep catalogue keys stable (`src/data/`).
7. Do not add dependencies without a line in `docs/ARCHITECTURE.md`.

## Licence

Repackshot is source-available under the PolyForm Noncommercial License
1.0.0: free for any noncommercial purpose, no commercial use of any kind
without a separate licence from the copyright holder. See [LICENSE](LICENSE)
and the summary in the README.

**Your contributions.** By opening a pull request you confirm that the
contribution is your own work (or comes from a source whose licence allows
it, with its notices kept), and you agree that it is distributed under the
project's licence **and** that the copyright holder may also license it
under other terms, including commercial ones. Without that second part the
author could not offer commercial licences of the project as a whole. If
you cannot agree to it, do not contribute.

Dependencies: only permissive licences (MIT, Apache-2.0, BSD, ISC, CC0)
are compatible with this setup. Copyleft (GPL, AGPL) or noncommercial
dependencies cannot be added to the code base. The one exception is
`occt-import-js` (LGPL-2.1) for STEP and IGES import: it is shipped
unmodified as a separate, replaceable module loaded at run time, never
bundled, with its licence and a link to its source next to it
(`docs/ARCHITECTURE.md` §1).
