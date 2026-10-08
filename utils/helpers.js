export async function waitForNetworkIdle(page, timeout = 5_000) {
  await page.waitForLoadState('networkidle', { timeout });
}

export function uniqueSuffix() {
  return Date.now().toString(36);
}

export function formatPrice(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}
