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

GitHub publishing was blocked: the connected integration returned HTTP 403 "Resource not accessible by integration" for tree and branch creation, despite the user account's repository push permission. No remote branch, commit or PR was created. A transfer patch is supplied so local Codex can apply these changes and push a draft PR from the user's authenticated checkout.

Keep that PR a draft until local browser and Blender checks complete. No production SQL, hosting deployment, history migration, or finished 3D battlefield is part of this change.

## Local Windows verification — 2026-10-08

- Applied cleanly to a new branch from `main`; the checkout had no uncommitted edits.
- Installed locked npm dependencies using a temporary Node.js 22.21.1 runtime. `setup:dev` installed local Git LFS hooks and downloaded Playwright Chromium. Node.js LTS 24.20.0 was then installed for this Windows user via WinGet, which updated the user PATH; a new shell or VS Code restart is needed to pick it up.
- Passed: 158 gameplay tests (one worker), three tooling tests, asset inventory, TypeScript/Vite production build, world and SQL consistency, upgrade database integration, and fresh-install database integration.
- Chromium smoke run: desktop Canvas compatibility map passed. Desktop quick battle timed out after its deployment capture; the failure screenshot was blank. Desktop WebGL map timed out during browser context teardown. The run was stopped before mobile cases. Browser rendering is not yet verified on this machine.
- Blender MCP `get_addon_status` could not connect, and TCP localhost:9876 was closed. Start the add-on server in Blender and retry. `uvx` was found by the elevated setup process, but not by the initial sandboxed PATH check.
- Context7 launcher was invoked, but no service response or tool call was verified in this session.
