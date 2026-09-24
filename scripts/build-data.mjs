import { spawnSync } from 'node:child_process';
import { refreshPageUpdates } from './lib/page-updates.mjs';
for (const task of ['build:data:core','sync:assets','build:folks','build:shortform','sync:documents','build:catalogs','build:video-audio','build:home-search']) {
  const result = spawnSync('npm', ['run',task], {stdio:'inherit',env:{...process.env,DEFER_PAGE_UPDATES:'1'}});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await refreshPageUpdates();
