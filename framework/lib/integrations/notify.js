import { collectSecrets } from '../site/redact.js';
import { buildSlackMessage, sendSlack, shouldNotifySlack } from './slack.js';
import { JiraClient, syncFailures } from './jira.js';

/**
 * Sends the run's outcome to the integrations that are configured. Never throws and never fails the job:
 * a broken integration must not turn a green test run red. Returns what happened, in words, for the log.
 */
export async function notifyRun({ env = process.env, meta, diagnosis, fetchImpl = fetch }) {
  const secrets = collectSecrets(env);
  const summary = { slack: 'not configured', jira: 'not configured' };
  const reportUrl = env.GITHUB_REPOSITORY ? `https://${env.GITHUB_REPOSITORY.split('/')[0].toLowerCase()}.github.io/${env.GITHUB_REPOSITORY.split('/')[1]}/latest/${meta.suite}/` : '';
  let jiraResult = null;
  if (env.JIRA_BASE_URL && env.JIRA_API_TOKEN) {
    try {
      const client = new JiraClient({ baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, projectKey: env.JIRA_PROJECT_KEY, issueType: env.JIRA_ISSUE_TYPE || 'Bug', fetchImpl });
      jiraResult = await syncFailures({ client, diagnosis, meta, reportUrl, autoCreate: env.JIRA_AUTO_CREATE === 'true', secrets });
      summary.jira = jiraResult;
    } catch (error) {
      summary.jira = `failed: ${String(error.message).slice(0, 120)}`;
    }
  }
  if (env.SLACK_WEBHOOK_URL) {
    if (!shouldNotifySlack({ meta, mode: env.SLACK_NOTIFY || 'failures' })) summary.slack = 'skipped (run passed)';
    else {
      try {
        await sendSlack({ webhookUrl: env.SLACK_WEBHOOK_URL, payload: buildSlackMessage({ meta, diagnosis, reportUrl, jira: jiraResult, secrets }), fetchImpl });
        summary.slack = 'sent';
      } catch (error) {
        summary.slack = `failed: ${String(error.message).slice(0, 120)}`;
      }
    }
  }
  return summary;
}
