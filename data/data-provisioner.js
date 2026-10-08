// Data module — unique, prefixed test data + per-test cleanup registry.
// Adapted from the framework's data-agent/data-provisioner.js: this app needs page titles,
// not synthetic users/datasets. Every title carries DATA_TEST_PREFIX so leftovers are sweepable.

const TEST_PREFIX = process.env.DATA_TEST_PREFIX ?? 'qa-auto-';

export class DataProvisioner {
  static prefix() {
    return TEST_PREFIX;
  }

  /** Unique page title, e.g. "qa-auto-rename-k3j9x2" (label is slugified). */
  static pageTitle(label = 'page') {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${TEST_PREFIX}${slug}-${DataProvisioner._uid()}`;
  }

  static _uid() {
    return Math.random().toString(36).slice(2, 8);
  }
}
