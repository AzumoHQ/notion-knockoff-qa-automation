import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { notifyRun } from '../lib/integrations/notify.js';
import { buildSlackMessage, shouldNotifySlack } from '../lib/integrations/slack.js';
import { ticketCandidates } from '../lib/integrations/jira.js';

const meta = (over = {}) => ({ suite: 'smoke', runId: '900', attempt: '1', status: 'failed', counts: { passed: 3, failed: 2, flaky: 1, skipped: 0 }, runUrl: 'https://github.com/o/r/actions/runs/900', ...over });
const item = (title, category, confidence = 'medium', status = 'unexpected') => ({ title, category, confidence, status, reason: 'the observed value differs from the expected one', message: 'Expected: 200\nReceived: 500', alternatives: [] });
const diagnosis = { counts: { product: 1, selector: 1 }, items: [item('TC0042 - saves the page', 'product'), item('TC0043 - opens menu', 'selector')] };

async function mockServers({ jiraSearchNew = true, jiraDown = false } = {}) {
  const jira = { issues: [], comments: {}, calls: [] };
  const slack = { messages: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const json = (status, data) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      if (req.url === '/slack') {
        slack.messages.push(body);
        return json(200, {});
      }
      jira.calls.push(`${req.method} ${req.url.split('?')[0]}`);
      if (jiraDown) return json(500, {});
      const search = (jql) => {
        const label = /labels = "(TC\d+)"/.exec(jql)[1];
        return { issues: jira.issues.filter((i) => i.labels.includes(label)).map((i) => ({ key: i.key })) };
      };
      if (req.method === 'POST' && req.url === '/rest/api/3/search/jql') return jiraSearchNew ? json(200, search(body.jql)) : json(404, {});
      if (req.method === 'GET' && req.url.startsWith('/rest/api/3/search?')) return json(200, search(decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('jql'))));
      if (req.method === 'POST' && req.url === '/rest/api/3/issue') {
        const key = `QA-${jira.issues.length + 1}`;
        jira.issues.push({ key, labels: body.fields.labels, fields: body.fields });
        return json(201, { key });
      }
      const issueGet = /^\/rest\/api\/3\/issue\/([\w-]+)\?fields=description/.exec(req.url);
      if (issueGet && req.method === 'GET') return json(200, { fields: { description: jira.issues.find((i) => i.key === issueGet[1])?.fields.description } });
      const comment = /^\/rest\/api\/3\/issue\/([\w-]+)\/comment/.exec(req.url);
      if (comment && req.method === 'GET') return json(200, { comments: jira.comments[comment[1]] ?? [] });
      if (comment && req.method === 'POST') {
        (jira.comments[comment[1]] ??= []).push(body.body);
        return json(201, {});
      }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, jira, slack, close: () => server.close(), env: (extra = {}) => ({ SLACK_WEBHOOK_URL: `${url}/slack`, JIRA_BASE_URL: url, JIRA_EMAIL: 'qa@example.test', JIRA_API_TOKEN: 'jira-token-123456', JIRA_PROJECT_KEY: 'QA', GITHUB_REPOSITORY: 'Owner/Repo', ...extra }) };
}

test('slack notifies failures by default and everything on request', () => {
  assert.equal(shouldNotifySlack({ meta: meta() }), true);
  assert.equal(shouldNotifySlack({ meta: meta({ status: 'passed' }) }), false);
  assert.equal(shouldNotifySlack({ meta: meta({ status: 'passed' }), mode: 'always' }), true);
});

test('the slack message links the run and the report, lists failures, and carries no secret', () => {
  const secrets = [{ value: 'hunter2-password', label: '[redacted]' }];
  const { text } = buildSlackMessage({ meta: meta({ attempt: '2' }), diagnosis: { ...diagnosis, items: [item('TC0042 - uses hunter2-password', 'product')] }, reportUrl: 'https://o.github.io/r/latest/smoke/', secrets });
  assert.match(text, /smoke\* failed: 3 passed, 2 failed, 1 flaky \(attempt 2\)/);
  assert.match(text, /workflow run/);
  assert.match(text, /latest\/smoke/);
  assert.ok(!text.includes('hunter2-password'));
});

test('only product failures with enough confidence become ticket candidates', () => {
  const items = [item('TC0001 a', 'product', 'high'), item('TC0002 b', 'product', 'low'), item('TC0003 c', 'selector'), item('TC0004 d', 'product', 'medium', 'flaky'), item('TC0005 e', 'known-defect'), item('no id', 'product')];
  assert.deepEqual(ticketCandidates({ items }).map((i) => i.title), ['TC0001 a']);
});

test('with auto-create off nothing is written to Jira and the would-be issue is reported', async () => {
  const s = await mockServers();
  try {
    const out = await notifyRun({ env: s.env({ JIRA_AUTO_CREATE: 'false' }), meta: meta(), diagnosis });
    assert.deepEqual(out.jira.wouldCreate, ['TC0042']);
    assert.ok(!s.jira.calls.some((c) => c.startsWith('POST /rest/api/3/issue')));
    assert.equal(out.slack, 'sent');
    assert.match(s.slack.messages[0].text, /Jira \(not created, auto-create is off\): TC0042/);
  } finally {
    s.close();
  }
});

test('one issue per case: created once, then commented once per run, never duplicated', async () => {
  const s = await mockServers();
  try {
    const env = s.env({ JIRA_AUTO_CREATE: 'true' });
    const first = await notifyRun({ env, meta: meta(), diagnosis });
    assert.deepEqual(first.jira.created, ['QA-1']);
    assert.deepEqual(s.jira.issues[0].labels, ['qa-auto', 'TC0042']);
    assert.match(s.jira.issues[0].fields.summary, /^\[QA\] TC0042/);

    const sameRunAgain = await notifyRun({ env, meta: meta(), diagnosis });
    assert.equal(s.jira.issues.length, 1, 'no second issue');
    assert.deepEqual(sameRunAgain.jira.skipped, ['TC0042 (already noted for this run)']);
    assert.equal(sameRunAgain.jira.commented.length, 0);

    const nextRun = await notifyRun({ env, meta: meta({ runId: '901', runUrl: 'https://github.com/o/r/actions/runs/901' }), diagnosis });
    assert.deepEqual(nextRun.jira.commented, ['QA-1']);
    assert.equal(s.jira.issues.length, 1);
    const again = await notifyRun({ env, meta: meta({ runId: '901', runUrl: 'https://github.com/o/r/actions/runs/901' }), diagnosis });
    assert.equal(again.jira.commented.length, 0);
    assert.match(again.jira.skipped[0], /already noted/);
    assert.equal(s.jira.comments['QA-1'].length, 1, 'one comment per run');
  } finally {
    s.close();
  }
});

test('the older Jira search endpoint is used when the new one does not exist', async () => {
  const s = await mockServers({ jiraSearchNew: false });
  try {
    const out = await notifyRun({ env: s.env({ JIRA_AUTO_CREATE: 'true' }), meta: meta(), diagnosis });
    assert.deepEqual(out.jira.created, ['QA-1']);
    assert.ok(s.jira.calls.includes('GET /rest/api/3/search'));
  } finally {
    s.close();
  }
});

test('a Jira outage is reported but Slack still goes out, and nothing throws', async () => {
  const s = await mockServers({ jiraDown: true });
  try {
    const out = await notifyRun({ env: s.env({ JIRA_AUTO_CREATE: 'true' }), meta: meta(), diagnosis });
    assert.deepEqual(out.jira.errors.length, 1);
    assert.equal(out.slack, 'sent');
    assert.ok(!JSON.stringify(out).includes('jira-token-123456'));
  } finally {
    s.close();
  }
});

test('unconfigured integrations do nothing, and a passing run sends no Slack message', async () => {
  const s = await mockServers();
  try {
    assert.deepEqual(await notifyRun({ env: {}, meta: meta(), diagnosis }), { slack: 'not configured', jira: 'not configured' });
    const out = await notifyRun({ env: s.env(), meta: meta({ status: 'passed' }), diagnosis: { items: [], counts: {} } });
    assert.equal(out.slack, 'skipped (run passed)');
    assert.equal(s.slack.messages.length, 0);
  } finally {
    s.close();
  }
});
