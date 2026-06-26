// tests/run.mjs — 모든 *.test.mjs 를 한 번에 실행한다.
//   사용법:  node tests/run.mjs    (또는  npm test)
//   프레임워크 없음 — 각 테스트 파일은 import 되는 순간 assert 로 스스로 검증한다.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const f of files) {
  try {
    await import('./' + f);
    console.log(`  ✅ ${f}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${f}\n     ${e.message}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} 통과`);
process.exit(failed ? 1 : 0);
