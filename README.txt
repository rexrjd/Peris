Peris V19.6 — City / Map floating top bar

Based on main commit 7f7094942fd16926d63c912f65275de45b095caa. This package contains one updated source file.

The native 3D city now fills the space behind the shared top bar, just like the map. The middle gap shows city scenery. Floating city panels remain below the header buttons.

Installation
Copy src/ into your repository root, preserving its path and replacing compact-header.css. Alternatively, apply city-topbar.patch with git apply; use only one installation method.

Validation
- Build, TypeScript, artifact art and research art checks passed.
- Unit tests: 452 passed, one skipped; no failures.
- Tooling: four tests passed.
- Asset checks: all 46 registered GLB files passed.
- Browser checks: six city interaction tests plus desktop/mobile header parity checks passed. Screenshots inspected.

No SQL migration is required.
