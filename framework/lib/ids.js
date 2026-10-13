/** Stable case IDs: `TC` + at least four digits, at the start of a test title ("TC0042 - title"). */
export const CASE_ID = /^TC\d{4,}$/;
const TITLE_ID = /^(TC\d{4,})(?=[\s:\-[]|$)/;

export function idFromTitle(title) {
  return TITLE_ID.exec(title.trim())?.[1] ?? null;
}

export function nextId(ids) {
  const max = ids.map((id) => Number.parseInt(id.slice(2), 10)).reduce((a, b) => Math.max(a, b), 0);
  return `TC${String(max + 1).padStart(4, '0')}`;
}
