// Optional flows run by `npm run qa -- api-discover` after it has visited the app's links.
// Each flow receives a logged-in Playwright page and may navigate or read, to make the app call more endpoints.
// Do not create, edit or delete data here: discovery must stay free of side effects.
export default [
  // async (page) => {
  //   await page.goto('/settings');
  //   await page.waitForLoadState('networkidle');
  // },
];
