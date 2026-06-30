/**
 * Playwright global-teardown: runs once after all tests complete.
 * Removes the fixture database created by global-setup.ts.
 */

import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const FIXTURE_DATA_DIR = join(resolve(process.cwd()), 'tests', 'e2e', 'fixtures', 'data');

export default async function globalTeardown(): Promise<void> {
  await rm(FIXTURE_DATA_DIR, { recursive: true, force: true });
  console.log('[e2e global-teardown] fixture DB removed');
}
