import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'src-tauri', 'resources');
const backendDest = path.join(dest, 'backend');

function run(cmd, args) {
  console.log(`[prepare-sidecar] ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

// 1. 构建后端
run('pnpm', ['--filter', '@husteryx/backend', 'build']);

// 2. 部署生产依赖（pnpm 10 需 --legacy 才能部署非 inject 的 workspace 包；
//    必须 node-linker=hoisted：Tauri 打包 resources 时会丢弃符号链接，
//    默认的 .pnpm 软链结构会让 .app 内的 node_modules 无法解析依赖）
rmSync(backendDest, { recursive: true, force: true });
mkdirSync(backendDest, { recursive: true });
run('pnpm', [
  'deploy',
  '--filter',
  '@husteryx/backend',
  '--prod',
  '--legacy',
  '--config.node-linker=hoisted',
  backendDest,
]);

// 3. 显式补齐构建产物与 package.json（deploy 不保证包含 dist）
cpSync(path.join(root, 'backend', 'dist'), path.join(backendDest, 'dist'), { recursive: true });
cpSync(path.join(root, 'backend', 'package.json'), path.join(backendDest, 'package.json'));

if (!existsSync(path.join(backendDest, 'node_modules', '@duckdb'))) {
  throw new Error('deploy 未包含 @duckdb 生产依赖，请检查 pnpm deploy 输出');
}
if (!existsSync(path.join(backendDest, 'dist', 'index.js'))) {
  throw new Error('缺少 backend/dist/index.js');
}

// 4. 内置当前架构的 Node 运行时
const nodeDest = path.join(dest, 'node', 'bin', 'node');
mkdirSync(path.dirname(nodeDest), { recursive: true });
cpSync(process.execPath, nodeDest);
chmodSync(nodeDest, 0o755);

console.log(`[prepare-sidecar] 完成：${dest}`);
