import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/navigation-events.json', import.meta.url)));
const ids = new Set(fixture.events.map((event) => event.navigationId));
if (ids.size < 2) process.exit(1);
console.log(`fixture contract: ${ids.size} navigation tickets`);
