// Writes corpus/dev/<id>/{scenario.mjs,schema.sql,expected.json} from the registry in _lib/families.mjs.
// Run once when the dev corpus changes:  node corpus/_tools/gen-dev.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS, schemaFor } from '../_lib/families.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev');
for (const [id, v] of Object.entries(VARIANTS)) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scenario.mjs'), `import { build } from '../../_lib/families.mjs';\nexport default build('${id}');\n`);
  writeFileSync(join(dir, 'schema.sql'), schemaFor(id));
  const expected = { id, expect: v.expect, scope: 'in', class: v.klass, driver: v.driver, ...(v.invariant ? { invariant: v.invariant } : {}), ...(v.fixPattern ? { fix: v.fixPattern } : {}) };
  writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
}
console.log(`wrote ${Object.keys(VARIANTS).length} dev scenarios`);
