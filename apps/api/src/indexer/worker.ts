// Outbox polling loop. Stub: no events are processed yet.
import { setTimeout as sleep } from "node:timers/promises";
import type { Config } from "../shared/config.ts";
import type { Logger } from "../shared/logger.ts";

export function startWorker(deps: { config: Config; logger: Logger }): {
	stop: () => Promise<void>;
} {
	const abort = new AbortController();

	const loop = async () => {
		while (!abort.signal.aborted) {
			deps.logger.debug(
				{ event: "indexer.idle", outcome: "skipped" },
				"no pending events",
			);
			await sleep(deps.config.indexer.pollMs, undefined, {
				signal: abort.signal,
			}).catch(() => {});
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
