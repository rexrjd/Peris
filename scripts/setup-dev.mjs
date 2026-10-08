import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const probe = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 15_000, windowsHide: true });
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed. ${result.error?.message ?? ''}`);
};

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 19)) throw new Error('Use Node.js 20.19+; Node.js 22 LTS is recommended.');
  console.log(`Node ${process.versions.node}: available`);
  const lfs = probe('git', ['lfs', 'version']);
  if (lfs.status === 0) {
    console.log(lfs.stdout.trim());
    if (!checkOnly) run('git', ['lfs', 'install', '--local']);
  } else console.log('Git LFS unavailable. Install Git LFS before committing files in assets/source/.');
  const uv = probe('uvx', ['--version']);
  console.log(uv.status === 0 ? `${uv.stdout.trim()}: Blender MCP launcher available` : 'uvx unavailable. Reuse/install your MCP for Blender prerequisites on this PC.');
  if (!checkOnly) run(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), 'install', 'chromium']);
  console.log('Project MCP configuration: .codex/config.toml. Open/trust this checkout and restart Codex.');
  console.log('In Blender: N > MCP for Blender > Start MCP Server (localhost:9876).');
  console.log('Context7 may require authentication/an API key if anonymous access is rate-limited.');
  console.log('This script does not install Blender, change global Codex settings, or prove MCP connectivity.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
