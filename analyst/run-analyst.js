// Glue between Playwright's JSON results and the Analyst modules (root-cause, flaky-detector, reporter).
// Usage: node analyst/run-analyst.js [path/to/results.json]   (default: playwright-report/results.json)
import fs from 'fs';
import path from 'path';
import { recordResult } from './flaky-detector.js';
import { generateReport } from './reporter.js';

const resultsPath = path.resolve(process.argv[2] ?? 'playwright-report/results.json');
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const strip = (s = '') => s.replace(/\x1b\[[0-9;]*m/g, '');

const failures = [];
let total = 0;

function walk(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      total++;
      const attempts = test.results;
      const last = attempts.at(-1);
      const flaky = test.status === 'flaky';
      // one record per test: flaky-detector counts a pass-after-retry as a failed run
      recordResult(spec.title, test.status === 'expected' && !attempts.some((a) => a.status !== 'passed'));
      if (flaky) console.log(`[analyst] flaky (passed after ${attempts.length - 1} retr${attempts.length === 2 ? 'y' : 'ies'}): ${spec.title}`);
      if (test.status === 'unexpected') {
        failures.push({
          testTitle: spec.title,
          error: strip(last.error?.message ?? ''),
          traceFile: last.attachments?.find((a) => a.name === 'trace')?.path,
          screenshotFile: last.attachments?.find((a) => a.contentType === 'image/png')?.path,
        });
      }
    }
  }
  (suite.suites ?? []).forEach(walk);
}
results.suites.forEach(walk);

const report = generateReport(failures, total);
process.exitCode = report.summary.blockingFailures > 0 ? 1 : 0;
