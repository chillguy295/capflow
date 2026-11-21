import fs from 'node:fs';
const b = fs.readFileSync('assets/capflow.bundle.js','utf8');
const m = b.match(/var EXTRA="((?:[^"\\]|\\.)*)";/);
if (!m) { console.error('EXTRA not found — is assets/capflow.bundle.js there?'); process.exit(1); }
fs.mkdirSync('src', { recursive: true });
fs.writeFileSync('src/axiom.js', JSON.parse('"' + m[1] + '"'));
console.log('done');