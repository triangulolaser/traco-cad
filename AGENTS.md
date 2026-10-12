# AGENTS.md

Guide for anyone, human or coding agent, changing Traço CAD.

## What this project is

Traço is a 2D CAD for technical drawing and DWG/DXF interchange. It is plain JavaScript
(ES modules) on HTML5 Canvas, packaged as a desktop app with Tauri. It is CAD only: nesting,
CAM and machine post-processing are out of scope.

## Layout

| Path | Contents |
|---|---|
| `src/cad/` | Engine: document model, geometry, commands, snaps, rendering, file formats |
| `src/cad/locales/` | Interface translations (`en.js`, `es.js`) |
| `src/cad/i18n.js` | Interface language: detection, `tr()`, `translateDom()` |
| `src/cad.js` | Interface shell: ribbon, panels, tabs, properties |
| `src/main.js`, `src/updater.js` | Desktop bridge and signed auto-update |
| `src-tauri/` | Native app (Rust/Tauri 2) |
| `tests/` | `node --test` suites for engine and interface |
| `examples/` | Sample drawings |

Read `glossary.md` before naming things; use its terms in code, tests and messages.

## Commands

```bash
npm ci
npm test              # must stay green
npx vite build        # web build; must succeed
npm run tauri dev     # desktop app (needs Rust and the Tauri prerequisites)
```

## Rules

- **Every change comes with a test** in `tests/`, and `npm test` passes before you finish.
- **Interface text is written in Brazilian Portuguese in the code** and translated at output.
  The Portuguese string is the translation key. Any new or changed user-facing text needs
  matching entries in `src/cad/locales/en.js` and `es.js`; `tests/cad-i18n.test.js` fails
  otherwise. Build messages with template strings (`` `Opened ${name}` ``), not string
  concatenation, so the translator can match them.
- **Do not rename stored keys** (`mvp-cad:*` in `localStorage`, the `mvp-cad` IndexedDB
  database): installed copies keep open tabs and settings there.
- **File fidelity first.** DXF/DWG written by Traço must open in other CAD programs. A test
  that only re-reads its own output does not prove compatibility.
- **No network calls** besides the update check. No telemetry, analytics or remote logging.
- **No new runtime dependencies** without a clear need; the engine has none in its core.
- Command names (`LINE`, `CIRCLE`, `TRIM`…) and their aliases are part of the user interface
  and must not change meaning.
- Keep the diff focused: no drive-by reformatting, no generated files (`dist/`,
  `src-tauri/target/`) in commits.

## Contributing

Open a pull request against `main`. By contributing you agree to the
[Contributor License Agreement](CLA.md); sign off your commits (`git commit -s`). Accepted
changes are applied by the maintainers to their upstream tree, from which releases are built
and this repository is updated.

Official installers are built, signed and published by Triângulo Laser; source builds check
for updates at the same address.
