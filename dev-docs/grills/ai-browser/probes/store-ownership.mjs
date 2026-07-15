// Native execution requires the packaged Tauri app. This probe validates the fixture
// contract in CI and is intentionally not a claim that a WebKit cookie probe ran.
import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/provenance-tabs.json', import.meta.url)));
if (fixture.tabs.filter((tab) => tab.automationMode === 'ai-sandbox').length !== 1) process.exit(1);
console.log('fixture contract: sandbox provenance present');
