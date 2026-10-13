import { spawnSync } from 'node:child_process';

/** The instruction given to Claude Code after the deterministic scaffold. Same text for `init` and `qa explore`. */
export function explorePrompt() {
  return [
    'Use the ai-driven-automation-framework skill and follow docs/business-rules.md exactly.',
    'The framework is already scaffolded (.qa-framework.json, playwright.config.js, auth/, workflows, framework/):',
    'do NOT rewrite those files; extend pages/, fixtures/, tests/, test-cases/, api/ and docs/.',
    'Credentials and URL are in .env (never print or commit secrets).',
    'Run the whole flow without stopping for approvals: explore the app, write docs/app-map.md,',
    'docs/business-rules.md (application rules) and docs/technical-context.md, generate page objects, specs,',
    'test case definitions and (if the API option is on) the API discovery and tests,',
    'run them, fix root causes, commit locally (do not push), and finish with a short summary.',
  ].join(' ');
}

export function runExplore({ spawn = spawnSync } = {}) {
  return spawn('claude', ['-p', explorePrompt(), '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep,Skill'], { stdio: 'inherit' });
}
