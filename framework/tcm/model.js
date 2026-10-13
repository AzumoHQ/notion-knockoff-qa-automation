// Pure helpers for the TCM page (no DOM): routing, filtering and tree counts. Unit-tested in Node.

export function parseRoute(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').map(decodeURIComponent).filter(Boolean);
  if (parts[0] === 'case' && parts[1]) return { view: 'case', id: parts[1] };
  if (parts[0] === 'type' && parts[1]) return { view: 'list', type: parts[1] };
  if (parts[0] === 'area' && parts[1] && parts[2]) return { view: 'list', type: parts[1], area: parts[2] };
  if (parts[0] === 'feature' && parts[1] && parts[2] && parts[3]) return { view: 'list', type: parts[1], area: parts[2], feature: parts[3] };
  return { view: 'list' };
}

export const routeFor = {
  all: () => '#/',
  type: (type) => `#/type/${encodeURIComponent(type)}`,
  area: (type, area) => `#/area/${encodeURIComponent(type)}/${encodeURIComponent(area)}`,
  feature: (type, area, feature) => `#/feature/${encodeURIComponent(type)}/${encodeURIComponent(area)}/${encodeURIComponent(feature)}`,
  case: (id) => `#/case/${encodeURIComponent(id)}`,
};

const haystack = (c) => [c.id, c.title, c.area, c.feature, ...c.tags, ...c.preconditions, ...c.steps, ...c.expected].join(' ').toLowerCase();

/** `filters` values of '' mean "any". All words of `query` must appear somewhere in the case. */
export function filterCases(cases, { query = '', area = '', feature = '', type = '', priority = '', automation = '' } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return cases.filter(
    (c) =>
      (!area || c.area === area) &&
      (!feature || c.feature === feature) &&
      (!type || c.type === type) &&
      (!priority || c.priority === priority) &&
      (!automation || c.automation === automation) &&
      words.every((w) => haystack(c).includes(w)),
  );
}

export function distinct(cases, key) {
  return [...new Set(cases.map((c) => c[key]))].sort();
}

const TYPE_ORDER = ['ui', 'api'];

/** Test type (UI, API) at the top, then area, then feature. Types follow TYPE_ORDER; areas and features keep catalog order. */
export function buildTree(cases) {
  const types = new Map();
  for (const c of cases) {
    const areas = types.get(c.type) ?? types.set(c.type, new Map()).get(c.type);
    const features = areas.get(c.area) ?? areas.set(c.area, new Map()).get(c.area);
    features.set(c.feature, (features.get(c.feature) ?? 0) + 1);
  }
  const rank = (type) => (TYPE_ORDER.includes(type) ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length);
  return [...types.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([type, areas]) => {
      const list = [...areas.entries()].map(([name, features]) => ({ name, features: [...features.entries()].map(([f, count]) => ({ name: f, count })) }));
      for (const area of list) area.count = area.features.reduce((n, f) => n + f.count, 0);
      return { type, count: list.reduce((n, a) => n + a.count, 0), areas: list };
    });
}
