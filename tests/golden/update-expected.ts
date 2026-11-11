// Regenerates expected.json from the oracle (never from the API). Run it only when the
// dataset, the queries or the oracle change on purpose, and review the diff:
//
//   node tests/golden/update-expected.ts && npx biome format --write tests/golden
import { writeFileSync } from "node:fs";
import { buildDataset, COUNT, SEED } from "./dataset.ts";
import { encode, expectedFor } from "./oracle.ts";
import { buildQueries } from "./queries.ts";

const { final } = buildDataset();
const queries: Record<string, { total: number; order: string }> = {};
for (const spec of buildQueries(final)) {
	queries[spec.name] = encode(expectedFor(spec, final));
}

const file = new URL("./expected.json", import.meta.url);
writeFileSync(
	file,
	`${JSON.stringify({ seed: SEED, count: COUNT, queries }, null, "\t")}\n`,
);
console.log(`expected.json: ${Object.keys(queries).length} queries`);
