import { parseAriaSnapshot } from './locator.js';

const SYSTEM = `You repair broken Playwright locators. A step failed because its locator found no element.
You will get the old locator and a numbered list of elements that exist on the page now.
Choose the one element that is clearly the same control after a rename or redesign, or answer null if none is clearly the same.
Never invent an element that is not in the list. Never judge or change assertions.
Answer with JSON only: {"choice": <number or null>, "reason": "<one short sentence>"}`;

const COMPATIBLE = {
  getByRole: (parsed) => [parsed.role],
  getByText: () => ['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch'],
  getByLabel: () => ['textbox', 'combobox', 'searchbox', 'checkbox', 'radio', 'switch', 'spinbutton', 'slider'],
  getByPlaceholder: () => ['textbox', 'searchbox', 'combobox'],
  getByTitle: () => ['button', 'link', 'heading', 'tab', 'menuitem'],
};

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Tier 3: when the deterministic rules found nothing or tied, ask an LLM to PICK from the elements on the page.
 * It can only choose from a list the framework built, so the answer is checked mechanically: same kind of role,
 * a name that occurs exactly once, chosen by index. The result is marked `proposedBy: 'llm'`, goes through the
 * same source mapping and re-run as any other suggestion, and is never applied here.
 */
export async function llmPick({ llm, parsed, action, snapshots }) {
  const roles = COMPATIBLE[parsed.method]?.(parsed);
  if (!roles) return { status: 'unsupported', reason: `${parsed.method} cannot be checked against an ARIA snapshot` };
  const nodes = snapshots.flatMap((s) => parseAriaSnapshot(s.snapshot)).filter((n) => roles.includes(n.role) && n.name && !n.disabled);
  const unique = [...new Map(nodes.map((n) => [`${n.role}\u0000${n.name}`, { ...n, copies: 0 }])).values()];
  for (const n of nodes) unique.find((u) => u.role === n.role && u.name === n.name).copies++;
  if (!unique.length) return { status: 'none', reason: 'the page has no element of a compatible kind to choose from' };
  const prompt = `Old locator: ${parsed.method}(${quote(parsed.role ?? '')}${parsed.text ? `, name ${quote(parsed.text)}` : ''}); action: ${action}.\nElements on the page now:\n${unique.slice(0, 80).map((n, i) => `${i + 1}. ${n.role} "${n.name}"`).join('\n')}`;
  let answer;
  try {
    answer = await llm.complete({ system: SYSTEM, prompt, maxTokens: 200 });
  } catch (error) {
    return { status: 'none', reason: `the LLM could not be reached (${String(error.message).slice(0, 80)}); deterministic result kept` };
  }
  let choice;
  try {
    choice = JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? '');
  } catch {
    return { status: 'none', reason: 'the LLM answer was not valid JSON; ignored' };
  }
  if (choice.choice === null || choice.choice === undefined) return { status: 'none', reason: `the LLM saw no clear match${choice.reason ? `: ${String(choice.reason).slice(0, 120)}` : ''}` };
  const picked = Number.isInteger(choice.choice) ? unique.slice(0, 80)[choice.choice - 1] : null;
  if (!picked) return { status: 'rejected', reason: 'the LLM chose something that is not in the list; ignored' };
  if (picked.copies > 1) return { status: 'ambiguous', reason: `the chosen name "${picked.name}" appears ${picked.copies} times` };
  return {
    status: 'suggested',
    proposedBy: 'llm',
    candidate: { role: picked.role, name: picked.name, score: null },
    replacement: `getByRole(${quote(picked.role)}, { name: ${quote(picked.name)}, exact: true })${parsed.chain}`,
    llmReason: String(choice.reason ?? '').slice(0, 160),
    checks: { uniqueInSnapshot: true, pickedFromList: true },
  };
}
