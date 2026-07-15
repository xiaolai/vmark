import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/navigation-policy.json', import.meta.url)));
if (!fixture.cases.some((test) => test.expected === 'block')) process.exit(1);
if (!fixture.cases.some((test) => test.expected === 'allow')) process.exit(1);
console.log(`fixture contract: ${fixture.cases.length} navigation cases`);
