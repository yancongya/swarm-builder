/**
 * 产物门禁 CLI（与 vite 构建里的 closeBundle 同一套逻辑，供打包前单独复跑）：
 *   node --experimental-strip-types minitool/build/gate-cli.ts [dist目录]
 * 不带参数时检查 minitool/dist。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArtifact } from './gate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? join(here, '..', 'dist');
const issues = checkArtifact(target);

if (issues.length > 0) {
  console.error(`门禁未过（${issues.length} 项）：`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`门禁通过：${target}`);
