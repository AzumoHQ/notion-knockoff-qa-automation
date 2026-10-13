import fs from 'node:fs';
import path from 'node:path';
import { redactDeep, redactText } from './redact.js';

// Only attachments whose content can be redacted are published: plain text, JSON and CSV. Images cannot be
// scanned for secrets or personal data, so screenshots are published only when the project opts in
// (`artifacts.screenshots`). Everything else (traces, videos, HTML, SVG, PDF, archives, unknown types) is withheld,
// as are ARIA snapshots and Playwright's error-context, which hold page text.
const TEXT_TYPE = /^(text\/plain|text\/csv|application\/json)(;|$)/;
const IMAGE_TYPE = /^image\/(png|jpeg|webp)$/;
const BLOCKED_NAME = /^(trace|video|heal-evidence|error-context)/i;

function blocked(attachment, screenshots) {
  if (BLOCKED_NAME.test(attachment.name ?? '')) return true;
  const type = attachment.type ?? '';
  if (TEXT_TYPE.test(type)) return false;
  return !(screenshots && IMAGE_TYPE.test(type));
}

function filterAttachments(node, kept, dropped, screenshots) {
  if (Array.isArray(node.attachments)) {
    node.attachments = node.attachments.filter((a) => {
      if (blocked(a, screenshots)) {
        dropped.push(a.name);
        return false;
      }
      kept.add(a.source);
      return true;
    });
  }
  for (const key of ['steps', 'befores', 'afters']) for (const child of node[key] ?? []) filterAttachments(child, kept, dropped, screenshots);
}

/**
 * Copies an allure-results folder without anything that must not be public: blocked attachments are dropped (and
 * their references removed), and every text is redacted. Returns { files, dropped } for the log.
 */
export function sanitizeAllureResults({ src, dest, secrets, screenshots = false }) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const kept = new Set();
  const dropped = [];
  const names = fs.existsSync(src) ? fs.readdirSync(src) : [];
  let files = 0;
  for (const name of names) {
    if (!/-(result|container)\.json$/.test(name)) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(src, name), 'utf8'));
    filterAttachments(doc, kept, dropped, screenshots);
    fs.writeFileSync(path.join(dest, name), JSON.stringify(redactDeep(doc, secrets)));
    files++;
  }
  for (const name of names) {
    if (/-(result|container)\.json$/.test(name)) continue;
    if (/-attachment/.test(name)) {
      if (!kept.has(name)) continue;
      if (/\.(json|txt|log|html|csv)$/.test(name)) fs.writeFileSync(path.join(dest, name), redactText(fs.readFileSync(path.join(src, name), 'utf8'), secrets));
      else fs.copyFileSync(path.join(src, name), path.join(dest, name));
    } else if (/\.(properties|json|xml)$/.test(name)) {
      fs.writeFileSync(path.join(dest, name), redactText(fs.readFileSync(path.join(src, name), 'utf8'), secrets));
    }
    files++;
  }
  return { files, dropped };
}
