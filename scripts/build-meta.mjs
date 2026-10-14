import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

let commit = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '';
if (!commit) {
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch {}
}
if (commit && !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Invalid deployment commit identifier');
await writeFile(new URL('../public/deployment.json', import.meta.url), JSON.stringify({ commit: commit || null, built_at: new Date().toISOString() }) + '\n');
