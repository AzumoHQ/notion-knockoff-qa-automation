import fs from 'node:fs';
import path from 'node:path';

const PATTERNS = [
  ['a JWT', /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/],
  ['a bearer token', /Bearer\s+(?!\[redacted\])[\w.~+/=-]{12,}/i],
  ['a secret query value', /\b(?:apikey|api_key|access_token|refresh_token|password|secret)=(?!\[redacted\])[^&\s"'<>]{4,}/i],
];
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|eot|mp4|webm|zip)$/i;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

/**
 * Last line of defence before anything is published: looks for the known secret values (and the common encodings
 * of them) and for token-shaped strings in every text file of the folder. Returns what was found WITHOUT the value.
 * The caller refuses to publish when the list is not empty.
 */
export function findLeaks(dir, secrets = []) {
  const found = [];
  for (const file of files(dir)) {
    if (BINARY.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(dir, file);
    for (const { value, label } of secrets) if (text.includes(value)) found.push({ file: rel, what: label === '[username]' ? 'a QA account name' : 'a secret value' });
    for (const [what, re] of PATTERNS) if (re.test(text)) found.push({ file: rel, what });
  }
  return found;
}
