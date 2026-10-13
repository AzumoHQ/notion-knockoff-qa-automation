import { expect } from '@playwright/test';

/**
 * Visual comparison with Playwright's own screenshot assertions. Tag the test @visual:
 *   test('TC0200 - dashboard looks right @visual', async ({ page }) => {
 *     await expectVisual(page, 'dashboard', { mask: [page.getByTestId('clock')] });
 *   });
 * `target` is a page or a locator: prefer a locator for a component, because the allowed difference
 * (maxDiffPixelRatio, 0.1% by default) is a share of the whole image and a small change in a big page can hide in it.
 * Mask anything that changes between runs (dates, avatars, counters). Baselines are updated only on purpose:
 * run the "Visual Tests" workflow with update_baselines and review the pushed images in a pull request.
 */
export async function expectVisual(target, name, { mask = [], fullPage = false, maxDiffPixelRatio } = {}) {
  await expect(target).toHaveScreenshot(`${name}.png`, { mask, ...(fullPage && { fullPage }), ...(maxDiffPixelRatio !== undefined && { maxDiffPixelRatio }) });
}
