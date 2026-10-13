export const DEFAULT_PREFIX = 'qa-auto-';

/** Names carry their creation time (base36), so age can be read from the name alone. */
export function makeName(prefix = DEFAULT_PREFIX, now = Date.now(), random = Math.random()) {
  return `${prefix}${now.toString(36)}-${random.toString(36).slice(2, 6)}`;
}

export function createdAtFromName(name, prefix = DEFAULT_PREFIX) {
  if (!name?.startsWith(prefix)) return null;
  const m = /^([0-9a-z]{8,9})-[0-9a-z]{1,4}$/.exec(name.slice(prefix.length));
  const ts = m ? Number.parseInt(m[1], 36) : NaN;
  return Number.isFinite(ts) && ts > 1.5e12 ? ts : null;
}

/**
 * Tracks what one test (or worker) created and removes it in reverse order. Removal never throws:
 * failures are returned so a cleanup problem cannot hide the test result; the sweeper recovers leftovers.
 */
export class CreatedResources {
  constructor({ resources, api, prefix = DEFAULT_PREFIX }) {
    this.resources = resources;
    this.api = api;
    this.prefix = prefix;
    this.items = [];
  }

  async create(kind, data = {}) {
    const definition = this.resources[kind];
    if (!definition) throw new Error(`Unknown resource kind "${kind}". Define it in api/api.config.js (resources).`);
    const name = data.name ?? makeName(this.prefix);
    const created = await definition.create(this.api, { ...data, name });
    // Registered before returning, so a failure later in the test cannot lose track of it.
    this.items.push({ kind, id: created.id, name });
    return { ...created, name };
  }

  async cleanup() {
    const failures = [];
    for (const item of this.items.splice(0).reverse()) {
      try {
        await this.resources[item.kind].remove(this.api, item);
      } catch (error) {
        failures.push({ ...item, error: String(error.message).slice(0, 200) });
      }
    }
    return failures;
  }
}
