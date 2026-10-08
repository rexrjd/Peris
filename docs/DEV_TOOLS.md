# Peris development tools

This toolkit configures the existing game; it does not replace its map or implement a 3D battle renderer. It adds project instructions, local MCP configuration, browser tests, model validation/optimization, Blender export, source-asset LFS rules, and GitHub checks.

## Start on Windows

1. Open the Peris repository folder in VS Code. Use the branch containing this toolkit, or main after the PR is merged. If delivered as a ZIP/patch, have local Codex apply it on a new branch first. Preserve any uncommitted work before changing branches.
2. Double-click `START-PERIS-TOOLS.cmd`. It runs `npm ci`, downloads Playwright Chromium, and installs Git LFS hooks in this checkout when Git LFS is available. Node.js 22 LTS is recommended.
3. Restart Codex in this folder and trust the project when prompted. Project MCP definitions live in `.codex/config.toml`; they do not change your chosen model or approval settings.
4. Open Blender, press N in the viewport, open MCP for Blender, and click Start MCP Server. Reuse the addon you already installed; the setup script does not reinstall it.

If npm is blocked in PowerShell, use `npm.cmd`. If `npx` or `uvx` cannot be found by Codex, restart VS Code after installation or set that command's absolute executable path in your local configuration. Existing global MCP servers can overlap with project definitions; use one Blender client/session at a time. Restart after configuration changes.

Context7 is configured without a committed API key. If its service requests authentication or reports rate limits, complete its official setup locally; never commit keys. The configuration is preparation, not evidence that every server connected. Ask local Codex to list tools and test each server.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run Peris locally |
| `npm run setup:dev` | Prepare Chromium and local Git LFS hooks |
| `npm run check:dev` | Check Node, Git LFS and uvx availability without installation |
| `npm test` | Existing gameplay and architecture checks |
| `npm run test:tooling` | Asset manifest validation checks |
| `npm run test:e2e` | Desktop/mobile Chromium gameplay and graphics smoke checks |
| `npm run test:e2e:ui` | Interactive Playwright runner |
| `npm run assets:check` | Registered model paths, size, provenance and glTF validation |
| `npm run assets:inspect -- model.glb` | Inspect model complexity |
| `npm run assets:optimize -- input.glb output.glb` | Optimize to a separate file |
| `npm run assets:validate -- output.glb` | Validate a glTF export |

Browser tests cover deployment, orders, pause/withdrawal, the actual strategic map, and the Canvas fallback. Screenshots are attached to the HTML report (`playwright-report/index.html`); failures include traces/video. These are smoke checks, not full visual regression baselines, exhaustive controls testing, or GPU benchmarks. Mobile emulation does not establish real phone performance.

GitHub Actions runs build/gameplay/generated-file/database/asset checks and browser tests. The workflow uses isolated test databases; it does not deploy to Supabase or Vercel. The browser report is uploaded as an artifact. Normal Git LFS storage and CI usage limits still apply.

## Local Codex handoff

> Apply the patch from PERIS_Local_Codex_Toolkit.zip to my existing rexrjd/Peris checkout, on a new codex/peris-development-toolkit branch. Preserve my local edits and resolve changed-file conflicts carefully. Read AGENTS.md and docs/DEV_TOOLS.md. Install dependencies, run setup:dev, verify Playwright and Context7 tools, and connect to my existing Blender MCP server on localhost:9876. Run all documented checks and report which connections actually work. Commit and push the toolkit, then open a draft PR. Read docs/GRAPHICS_PIPELINE.md and propose the smallest playable 3D battle renderer change that preserves all existing tactical rules. Do not claim that a finished character or 3D battlefield already exists.

## References

- Codex project instructions: https://developers.openai.com/codex/guides/agents-md/
- Codex MCP: https://developers.openai.com/codex/mcp/
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Context7: https://github.com/upstash/context7
- MCP for Blender: https://pypi.org/project/mcp-for-blender/
- glTF Transform: https://gltf-transform.dev/cli
