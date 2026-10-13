import { spawnSync } from 'node:child_process';

/** Runs `gh` and returns { status, stdout, stderr }. Replaced by a fake in tests. */
export function runGh(args, input) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function repoInfo(gh = runGh) {
  const r = gh(['repo', 'view', '--json', 'nameWithOwner,visibility,defaultBranchRef,viewerPermission']);
  if (r.status !== 0) return null;
  const info = JSON.parse(r.stdout);
  return { repo: info.nameWithOwner, visibility: info.visibility.toLowerCase(), defaultBranch: info.defaultBranchRef?.name ?? 'main', permission: info.viewerPermission };
}

/**
 * Turns on GitHub Pages with "GitHub Actions" as the source. Returns what happened in words, never throws:
 * { status: 'enabled' | 'already' | 'pending', reason?, url? }.
 */
export function enablePages({ repo, gh = runGh }) {
  const create = gh(['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
  if (create.status === 0) return { status: 'enabled', url: JSON.parse(create.stdout || '{}').html_url };
  const message = `${create.stderr} ${create.stdout}`;
  if (/already (exists|enabled)|409/i.test(message)) {
    const update = gh(['api', '-X', 'PUT', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
    if (update.status === 0 || /204|no content/i.test(update.stdout)) return { status: 'already' };
    return { status: 'pending', reason: 'Pages exists but its source could not be switched to GitHub Actions: set it in Settings > Pages > Build and deployment.' };
  }
  if (/403|resource not accessible|must have admin/i.test(message)) return { status: 'pending', reason: 'No admin permission on the repository: ask an admin to enable Settings > Pages > Source: GitHub Actions.' };
  if (/422|not available|upgrade|plan/i.test(message)) return { status: 'pending', reason: 'GitHub Pages is not available for this repository on its plan (private repositories need a paid plan): make it public or upgrade, then set Settings > Pages > Source: GitHub Actions.' };
  if (/404/.test(message)) return { status: 'pending', reason: 'The repository was not found on GitHub: push it first, then run `npm run qa -- pages`.' };
  return { status: 'pending', reason: `Unexpected answer from GitHub: ${message.trim().split('\n')[0].slice(0, 160)}` };
}

export function pagesUrl(repo) {
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

/** What gets published, in words, for the visibility the repository has. */
export function visibilityNotice(visibility, retentionDays) {
  const published = `Published on Pages (kept ${retentionDays} days): Allure reports (text only; screenshots only if the project allows it), the test case catalog, diagnosis, selector suggestions. Never published: traces, videos, page snapshots, credentials.`;
  if (visibility === 'public') {
    return `The repository is PUBLIC, so the Pages site is public and so are the artifacts of its workflow runs. ${published} Artifacts with traces and full reports are therefore not uploaded (set artifacts.includeTraces in .qa-framework.json to change this). Screenshots are not published either (artifacts.screenshots, 'auto' only publishes them for private repositories). Use test accounts with fake data anyway.`;
  }
  return `The repository is ${visibility}. GitHub Pages sites are public on most plans even for private repositories (except GitHub Enterprise Cloud with private Pages). ${published} Full reports and traces are uploaded as private artifacts only.`;
}
