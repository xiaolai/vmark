// M-2 / WI-2.4 — perf bench: index a 1k-note workspace. Run: `pnpm bench`.
// Excluded from `vitest run` (the coverage gate) — bench files match a
// separate include glob, so this never affects coverage thresholds.
import { bench, describe } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildIndex } from "./buildIndex";

const NOTE_COUNT = 1000;
const root = await fs.mkdtemp(path.join(os.tmpdir(), "vmark-kb-bench-"));
for (let i = 0; i < NOTE_COUNT; i++) {
  const next = (i + 1) % NOTE_COUNT;
  await fs.writeFile(
    path.join(root, `note-${i}.md`),
    `# Note ${i}\n\nLinks to [[note-${next}]] with #tag${i % 10}.\n\nSome **body** text and \`code\`.\n`,
    "utf8"
  );
}

describe(`buildIndex — ${NOTE_COUNT}-note workspace`, () => {
  bench(
    "build full index (walk + resolve + graph)",
    async () => {
      await buildIndex(root);
    },
    { time: 500 }
  );
});
