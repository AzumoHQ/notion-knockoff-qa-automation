import { redactText } from '../site/redact.js';

/** One message per workflow run (the job runs once per run attempt), failures only unless SLACK_NOTIFY=always. */
export function shouldNotifySlack({ meta, mode = 'failures' }) {
  return mode === 'always' || meta.status === 'failed';
}

export function buildSlackMessage({ meta, diagnosis, reportUrl = '', jira = null, secrets = [] }) {
  const c = meta.counts;
  const icon = meta.status === 'failed' ? ':x:' : ':white_check_mark:';
  const lines = [`${icon} *${meta.suite}* ${meta.status}: ${c.passed} passed, ${c.failed} failed, ${c.flaky} flaky${meta.attempt !== '1' ? ` (attempt ${meta.attempt})` : ''}`];
  const counts = Object.entries(diagnosis?.counts ?? {}).map(([k, n]) => `${k} ${n}`).join(', ');
  if (counts) lines.push(`Diagnosis: ${counts}`);
  for (const item of (diagnosis?.items ?? []).filter((i) => i.status === 'unexpected').slice(0, 5)) lines.push(`• ${item.title} — ${item.category} (${item.confidence})`);
  if (jira?.created.length) lines.push(`Jira created: ${jira.created.join(', ')}`);
  if (jira?.commented.length) lines.push(`Jira updated: ${jira.commented.join(', ')}`);
  if (jira?.wouldCreate.length) lines.push(`Jira (not created, auto-create is off): ${jira.wouldCreate.join(', ')}`);
  const links = [meta.runUrl && `<${meta.runUrl}|workflow run>`, reportUrl && `<${reportUrl}|report>`].filter(Boolean);
  if (links.length) lines.push(links.join(' · '));
  return { text: redactText(lines.join('\n'), secrets) };
}

export async function sendSlack({ webhookUrl, payload, fetchImpl = fetch }) {
  const res = await fetchImpl(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Slack answered ${res.status}`);
}
