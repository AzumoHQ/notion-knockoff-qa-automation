import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const defaultGit = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

/**
 * Applies `apply(dir)` to the site branch and pushes it, retrying when someone else pushed first.
 * The site lives on its own branch (default `qa-reports`) checked out in a git worktree, so the credentials the
 * workflow already has are reused. Several runs publishing at once end up merged: each retry re-applies on top
 * of the newest remote state.
 */
export function publishToBranch({ root = process.cwd(), branch = 'qa-reports', remote = 'origin', apply, message, dir = '.qa-out/site', maxAttempts = 5, git = defaultGit }) {
  const site = path.resolve(root, dir);
  const author = ['-c', 'user.name=qa-framework', '-c', 'user.email=qa-framework@users.noreply.github.com'];
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  const fetch = () => {
    try {
      git(root, ['fetch', '--quiet', remote, `+refs/heads/${branch}:${remoteRef}`]);
      return true;
    } catch {
      return false;
    }
  };
  fs.rmSync(site, { recursive: true, force: true });
  git(root, ['worktree', 'prune']);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exists = fetch();
    if (attempt === 1) {
      if (exists) git(root, ['worktree', 'add', '--force', '-B', branch, site, remoteRef]);
      else {
        const empty = git(root, ['hash-object', '-t', 'tree', '/dev/null']);
        const first = git(root, [...author, 'commit-tree', empty, '-m', 'Start QA reports branch']);
        git(root, ['worktree', 'add', '--force', '-B', branch, site, first]);
      }
    } else if (exists) {
      git(site, ['reset', '--hard', remoteRef]);
    }
    apply(site);
    git(site, ['add', '-A']);
    if (!git(site, ['status', '--porcelain'])) return { status: 'unchanged', attempts: attempt };
    git(site, [...author, 'commit', '--quiet', '-m', message]);
    try {
      git(site, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`]);
      return { status: 'pushed', attempts: attempt };
    } catch (error) {
      if (attempt === maxAttempts) throw new Error(`Could not publish after ${maxAttempts} attempts: ${String(error.stderr ?? error.message).split('\n')[0]}`);
    }
  }
  return { status: 'unchanged', attempts: maxAttempts };
}

/** Replaces a long history by one commit holding the same tree (run by the daily cleanup, not by every run). */
export function squashBranch({ root = process.cwd(), branch = 'qa-reports', remote = 'origin', keepCommits = 100, git = defaultGit }) {
  git(root, ['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  const ref = `refs/remotes/${remote}/${branch}`;
  const count = Number(git(root, ['rev-list', '--count', ref]));
  if (count <= keepCommits) return { squashed: false, commits: count };
  const author = ['-c', 'user.name=qa-framework', '-c', 'user.email=qa-framework@users.noreply.github.com'];
  const old = git(root, ['rev-parse', ref]);
  const squashed = git(root, [...author, 'commit-tree', `${ref}^{tree}`, '-m', 'QA reports (history squashed)']);
  git(root, ['push', '--quiet', `--force-with-lease=refs/heads/${branch}:${old}`, remote, `${squashed}:refs/heads/${branch}`]);
  return { squashed: true, commits: count };
}
