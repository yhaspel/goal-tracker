/**
 * Verifies every relative Markdown link in the repository.
 *
 *   node scripts/check-links.mjs
 *
 * Completed stage plans move into `development-plans/archived/` as the project progresses,
 * and every reference to a moved plan has to be repaired in the same change. This check makes
 * a missed reference fail loudly instead of rotting silently.
 *
 * External links (http, https, mailto) are not fetched. Fragments are resolved against the
 * target file's headings using GitHub's slug rules.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** GitHub's heading slug: lower-case, drop punctuation, spaces to hyphens. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Zs}-]/gu, '')
    .replace(/\p{Zs}+/gu, '-');
}

const anchorCache = new Map();
function anchorsOf(path) {
  if (!anchorCache.has(path)) {
    const seen = new Map();
    const anchors = new Set();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line);
      if (!heading) continue;
      const base = slug(heading[1]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    anchorCache.set(path, anchors);
  }
  return anchorCache.get(path);
}

const problems = [];

for (const file of files) {
  const absolute = join(root, file);
  const text = readFileSync(absolute, 'utf8');
  // Inline links and reference definitions, skipping fenced code blocks.
  const withoutCode = text.replace(/```[\s\S]*?```/g, match => match.replace(/[^\n]/g, ' '));
  for (const match of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|tel:|data:|#)/i.test(target)) {
      if (target.startsWith('#') && !anchorsOf(absolute).has(target.slice(1).toLowerCase())) {
        problems.push(`${file}: no heading matches ${target}`);
      }
      continue;
    }
    const [pathPart, fragment] = target.split('#');
    const resolved = resolve(dirname(absolute), decodeURIComponent(pathPart));
    if (!existsSync(resolved)) {
      problems.push(`${file}: ${target} -> missing ${relative(root, resolved)}`);
      continue;
    }
    if (fragment && statSync(resolved).isFile() && resolved.endsWith('.md')) {
      if (!anchorsOf(resolved).has(fragment.toLowerCase())) {
        problems.push(`${file}: ${target} -> no heading matches #${fragment}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} broken Markdown link(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Checked relative Markdown links in ${files.length} files; all resolve.`);
