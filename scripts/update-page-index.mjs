import { refreshPageUpdates } from './lib/page-updates.mjs';
import path from 'node:path';
if (process.env.DEFER_PAGE_UPDATES === '1') process.exit(0);
const updates=await refreshPageUpdates(path.resolve(process.env.SITE_DATA_DIR??'data'));
console.log(`Recent updates: ${updates.map(p=>p.title).join(', ')}`);
