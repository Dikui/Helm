import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { helmVersion } from '../src/version.js';

test('对外上报的版本号读自 package.json', () => {
  assert.equal(helmVersion, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
});
