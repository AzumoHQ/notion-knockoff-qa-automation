import test from 'node:test';
import assert from 'node:assert/strict';
import { enablePages, repoInfo, pagesUrl, visibilityNotice } from '../lib/github.js';

const fake = (responses) => {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    return responses.shift() ?? { status: 1, stdout: '', stderr: 'no more responses' };
  };
  gh.calls = calls;
  return gh;
};

test('pages are enabled with GitHub Actions as the source', () => {
  const gh = fake([{ status: 0, stdout: JSON.stringify({ html_url: 'https://o.github.io/r/' }), stderr: '' }]);
  assert.deepEqual(enablePages({ repo: 'o/r', gh }), { status: 'enabled', url: 'https://o.github.io/r/' });
  assert.match(gh.calls[0], /-X POST repos\/o\/r\/pages -f build_type=workflow/);
});

test('existing pages are switched to the Actions source', () => {
  const gh = fake([{ status: 1, stdout: '', stderr: 'HTTP 409: GitHub Pages is already enabled' }, { status: 0, stdout: '', stderr: '' }]);
  assert.equal(enablePages({ repo: 'o/r', gh }).status, 'already');
  assert.match(gh.calls[1], /-X PUT/);
});

test('what could not be configured is reported with the reason, never thrown', () => {
  const pending = (stderr) => enablePages({ repo: 'o/r', gh: fake([{ status: 1, stdout: '', stderr }]) });
  assert.match(pending('HTTP 403: Resource not accessible by integration').reason, /admin/);
  assert.match(pending('HTTP 422: Your current plan does not support GitHub Pages for this repository').reason, /plan/);
  assert.match(pending('HTTP 404: Not Found').reason, /not found/i);
  assert.equal(pending('weird').status, 'pending');
});

test('repository info is read from gh, and null when there is none', () => {
  const ok = fake([{ status: 0, stdout: JSON.stringify({ nameWithOwner: 'o/r', visibility: 'PUBLIC', defaultBranchRef: { name: 'master' }, viewerPermission: 'ADMIN' }), stderr: '' }]);
  assert.deepEqual(repoInfo(ok), { repo: 'o/r', visibility: 'public', defaultBranch: 'master', permission: 'ADMIN' });
  assert.equal(repoInfo(fake([{ status: 1, stdout: '', stderr: 'not a repo' }])), null);
  assert.equal(pagesUrl('Owner/Repo'), 'https://owner.github.io/Repo/');
});

test('the visibility notice says what is and is not published and what a public repository means', () => {
  const pub = visibilityNotice('public', 15);
  assert.match(pub, /PUBLIC/);
  assert.match(pub, /Never published: traces, videos, page snapshots, credentials/);
  assert.match(pub, /not uploaded/);
  assert.match(visibilityNotice('private', 15), /private artifacts only/);
});
