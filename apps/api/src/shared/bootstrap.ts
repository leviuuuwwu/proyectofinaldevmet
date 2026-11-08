// Fail-fast configuration load shared by every entrypoint.
import { type Component, type Config, parseConfig } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";

export function loadConfigOrExit(component: Component): {
	config: Config;
	logger: Logger;
} {
	const result = parseConfig(component, process.env);
	if (!result.ok) {
		createLogger(component, "info").fatal(
			{ event: "config.invalid", outcome: "failure", errors: result.errors },
			"invalid configuration",
		);
		process.exit(1);
	}
	return {
		config: result.config,
		logger: createLogger(component, result.config.logLevel),
	};
}
