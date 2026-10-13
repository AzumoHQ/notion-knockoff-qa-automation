import { idFromTitle } from '../ids.js';
import { redactText } from '../site/redact.js';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const codeBlock = (text) => ({ type: 'codeBlock', content: [{ type: 'text', text }] });

/** Atlassian Document Format -> plain text, keeping list items and paragraphs on their own lines. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  const children = (node.content ?? []).map(adfToText);
  if (node.type === 'listItem') return `- ${children.join(' ').trim()}\n`;
  if (node.type === 'heading') return `## ${children.join('')}\n`;
  if (['paragraph', 'codeBlock'].includes(node.type)) return `${children.join('')}\n`;
  if (node.type === 'hardBreak') return '\n';
  return children.join('');
}

/** Failures worth a ticket: diagnosed as a product problem with at least medium confidence. Never flaky, never known defects. */
export function ticketCandidates(diagnosis) {
  return (diagnosis?.items ?? []).filter((i) => i.status === 'unexpected' && i.category === 'product' && ['medium', 'high'].includes(i.confidence) && idFromTitle(i.title));
}

export class JiraClient {
  constructor({ baseUrl, email, token, projectKey, issueType = 'Bug', fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.projectKey = projectKey;
    this.issueType = issueType;
    this.fetch = fetchImpl;
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  async request(method, path, body, { allowMissing = false } = {}) {
    const res = await this.fetch(`${this.baseUrl}${path}`, { method, headers: { authorization: this.auth, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    if (!res.ok && !(allowMissing && [404, 405, 410].includes(res.status))) throw new Error(`Jira ${method} ${path.split('?')[0]} answered ${res.status}`);
    return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
  }

  /** Open issues this framework created for a case: label `qa-auto` plus the case ID. */
  async findOpen(caseId) {
    const jql = `project = "${this.projectKey}" AND labels = "qa-auto" AND labels = "${caseId}" AND statusCategory != Done`;
    let r = await this.request('POST', '/rest/api/3/search/jql', { jql, fields: ['key', 'status'], maxResults: 5 }, { allowMissing: true });
    if ([404, 405, 410].includes(r.status)) r = await this.request('GET', `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=key,status&maxResults=5`, undefined, { allowMissing: true });
    if ([404, 405, 410].includes(r.status)) throw new Error('Jira search endpoint not found');
    return r.data?.issues?.[0]?.key ?? null;
  }

  /** True when the issue's description or one of its comments already carries this run's marker. */
  async alreadyMentions(key, marker) {
    const issue = await this.request('GET', `/rest/api/3/issue/${key}?fields=description`);
    if (JSON.stringify(issue.data?.fields?.description ?? '').includes(marker)) return true;
    const r = await this.request('GET', `/rest/api/3/issue/${key}/comment?maxResults=100`);
    return JSON.stringify(r.data?.comments ?? []).includes(marker);
  }

  /** { key, title, description } with the description flattened to plain text. */
  async fetchIssue(key) {
    const r = await this.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description`);
    return { key, title: r.data?.fields?.summary ?? '', description: adfToText(r.data?.fields?.description) };
  }

  create({ summary, description, labels }) {
    return this.request('POST', '/rest/api/3/issue', { fields: { project: { key: this.projectKey }, summary: summary.slice(0, 240), issuetype: { name: this.issueType }, description, labels } });
  }

  comment(key, body) {
    return this.request('POST', `/rest/api/3/issue/${key}/comment`, { body });
  }
}

/**
 * One Jira issue per failing case, never two: an open issue for the case gets a comment (once per run) instead.
 * With autoCreate off nothing is written; the would-be issues are returned so they can be reported.
 */
export async function syncFailures({ client, diagnosis, meta, reportUrl = '', autoCreate = false, secrets = [] }) {
  const result = { created: [], commented: [], wouldCreate: [], skipped: [], errors: [] };
  for (const item of ticketCandidates(diagnosis)) {
    const caseId = idFromTitle(item.title);
    try {
      const existing = await client.findOpen(caseId);
      const runMarker = meta.runUrl || `run ${meta.runId}`;
      if (existing) {
        if (await client.alreadyMentions(existing, runMarker)) result.skipped.push(`${caseId} (already noted for this run)`);
        else if (autoCreate) {
          await client.comment(existing, doc(paragraph(`Failed again in ${meta.suite}: ${runMarker}. Diagnosis: ${item.category} (${item.confidence}).`)));
          result.commented.push(existing);
        } else result.wouldCreate.push(`comment on ${existing}`);
        continue;
      }
      if (!autoCreate) {
        result.wouldCreate.push(caseId);
        continue;
      }
      const description = doc(
        paragraph(`Automated case ${caseId} failed in the ${meta.suite} suite (${runMarker}).`),
        paragraph(`Diagnosis: ${item.category}, confidence ${item.confidence}. ${item.reason}.`),
        codeBlock(redactText(item.message, secrets).slice(0, 1500)),
        paragraph(reportUrl ? `Report: ${reportUrl}` : 'Report: see the workflow run.'),
        paragraph('Created automatically from a test failure; the diagnosis is an evidence-based guess, please confirm before acting.'),
      );
      const created = await client.create({ summary: `[QA] ${item.title}`, description, labels: ['qa-auto', caseId] });
      result.created.push(created.data?.key ?? caseId);
    } catch (error) {
      result.errors.push(`${caseId}: ${String(error.message).slice(0, 120)}`);
    }
  }
  return result;
}
