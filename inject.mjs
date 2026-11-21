import fs from 'node:fs';
const src = fs.readFileSync('src/axiom.js','utf8');
let b = fs.readFileSync('assets/capflow.bundle.js','utf8');
b = b.replace(/var EXTRA="(?:[^"\\]|\\.)*";/, 'var EXTRA=' + JSON.stringify(src) + ';');
fs.writeFileSync('assets/capflow.bundle.js', b);
console.log('injected');