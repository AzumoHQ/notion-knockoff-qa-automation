import { tms } from 'allure-js-commons';
import { idFromTitle } from '../lib/ids.js';
import { tcmBaseUrl } from '../lib/env.js';

/**
 * Fixtures every project spreads into its `test.extend`: `export const test = base.extend({ ...qaFixtures, ... })`.
 * All of them are automatic: specs do not request them.
 */
export const qaFixtures = {
  // Links each Allure result to its case in the TCM (only when the TCM address is known).
  _caseLink: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const id = idFromTitle(testInfo.title);
      const base = tcmBaseUrl();
      // Runtime API on purpose: annotations pushed from a fixture are not visible to the Allure reporter.
      if (id && base) await tms(`${base}#/case/${id}`, id);
      await use();
    },
    { auto: true },
  ],
};
