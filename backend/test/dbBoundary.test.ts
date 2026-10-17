import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIdsFor(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId);
}

describe('database driver boundary', () => {
  const importPg = "import pg from 'pg';\nexport const p = pg;\n";

  it.each([
    'backend/stages/x.ts',
    'backend/runner/x.ts',
    'backend/routes/x.ts',
    'frontend/src/x.ts',
  ])('rejects a driver import in %s', async (file) => {
    expect(await ruleIdsFor(importPg, file)).toContain('no-restricted-imports');
  });

  it('rejects pg-* packages too', async () => {
    const code = "import { Pool } from 'pg-pool';\nexport const p = Pool;\n";
    expect(await ruleIdsFor(code, 'backend/runner/x.ts')).toContain('no-restricted-imports');
  });

  it('allows a driver import in backend/data/', async () => {
    expect(await ruleIdsFor(importPg, 'backend/data/x.ts')).not.toContain('no-restricted-imports');
  });
});
