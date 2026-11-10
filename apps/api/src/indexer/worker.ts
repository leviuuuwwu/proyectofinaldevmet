// Outbox polling loop: full batches are followed immediately by the next one;
// empty or blocked cycles wait INDEXER_POLL_MS.
import { setTimeout as sleep } from "node:timers/promises";
import { countPending, type IndexerDeps, processBatch } from "./process.ts";

export function startWorker(deps: IndexerDeps): { stop: () => Promise<void> } {
	const abort = new AbortController();
	const { batchSize, pollMs } = deps.config.indexer;

	const loop = async () => {
		while (!abort.signal.aborted) {
			let full = false;
			try {
				const { processed, blocked } = await processBatch(deps);
				full = processed === batchSize;
				deps.metrics.outboxPending.set(await countPending(deps.pool));
				if (processed === 0) {
					deps.logger.debug(
						{
							event: "indexer.idle",
							outcome: "skipped",
							reason: blocked ? "reindex_in_progress" : "no_pending_events",
						},
						"no events processed",
					);
				}
			} catch (err) {
				deps.logger.error(
					{ event: "index.failed", outcome: "failure", err },
					"indexer cycle failed",
				);
			}
			if (!full) {
				await sleep(pollMs, undefined, { signal: abort.signal }).catch(
					() => {},
				);
			}
		}
	};
	const running = loop();

	return {
		stop: async () => {
			abort.abort();
			await running;
		},
	};
}
