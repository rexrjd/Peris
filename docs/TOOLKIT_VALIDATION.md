# Development toolkit validation — 2026-10-08

Base commit: `9168e20cf6081937ed50d8ad70400bb207abc11b`.

Passed in the cloud checkout:

- Production TypeScript/Vite build.
- All 158 existing gameplay/architecture tests.
- Three new asset inventory tests: provenance, paths/duplicates, budgets and corrupt headers.
- World and SQL generation consistency checks.
- Existing upgrade and fresh-install database integration suites (isolated databases).
- Empty initial asset manifest check.
- Playwright configuration/test TypeScript check and discovery of six desktop/mobile cases.
- TOML parse of all three MCP definitions.
- Playwright MCP and Context7 launchers resolve and expose their help commands. This is not an end-to-end service connection test.
- Blender export script Python syntax check.
- A temporary triangle GLB validates and passes the Meshopt/WebP optimization command. The optimized output has no validator errors; the validator reports that it cannot validate the Meshopt extension itself. This does not validate a character, textures, rig or animation.

Pending local verification:

- Chromium download failed repeatedly with an invalid/truncated ZIP in this environment. The six browser cases were discovered but not executed; screenshots and real browser visual QA are pending.
- Blender is not connected to this cloud checkout. Run the export in the user's local Blender version and inspect it before relying on the character pipeline.
- Local Codex project trust, PATH/executable discovery, and MCP connections must be checked on Windows. Context7 service access/authentication and Blender localhost:9876 are not established by the launcher checks.
- GPU frame rates, large animated armies, real mobile rendering and production deployment are not measured or changed by this toolkit.

The initial cloud GitHub integration returned HTTP 403 "Resource not accessible by integration" for tree and branch creation. The toolkit was subsequently committed as `a8565f6` in the `hjhjhj` checkout and recovered into the intended local checkout for verification and publication.

Keep that PR a draft until local browser and Blender checks complete. No production SQL, hosting deployment, history migration, or finished 3D battlefield is part of this change.

## Local Windows verification — 2026-10-08

- Recovered the exact `a8565f6` commit onto `codex/peris-development-toolkit` in the intended checkout. Its original `mehdi/map-overhaul` branch was clean and preserved.
- Installed locked dependencies with Node.js 24.20.0. `setup:dev` installed local Git LFS hooks and confirmed Chromium, `uvx`, and Git LFS. This shell needed the installed Node/uv directories added to PATH explicitly; restart VS Code if the commands are not discovered.
- Passed: 158 gameplay tests, three tooling tests, asset inventory, world and SQL consistency, upgrade and fresh-install database suites, and the TypeScript/Vite production build.
- Passed all six desktop/mobile Chromium smoke cases after scoping the battle-result button to its dialog, checking the mobile battle transition through the visible Pause control, and allowing the slow desktop WebGL case 120 seconds. Captured desktop/mobile deployment, paused battle, WebGL map, and Canvas compatibility screenshots were inspected. These checks do not measure a physical phone or GPU frame rate.
- The Playwright MCP launcher completed initialization and exposed browser tools. Context7 completed an actual React library lookup. Project trust/restart is still needed for these project MCP definitions to appear in Codex itself.
- Blender's add-on server was not listening at `localhost:9876`; a live MCP connection and export in the user's Blender version remain pending. Start its server in Blender before relying on the character pipeline.
- `npm ci` reported four high-severity dependency advisories. Dependency remediation was not part of this toolkit verification.
