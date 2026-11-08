// Smoke check after a deploy: /healthz, /readyz and /version must answer 200.
// Usage: BASE_URL=https://... npm run smoke
const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const TIMEOUT_MS = 5000;

let failed = false;
for (const path of ["/healthz", "/readyz", "/version"]) {
	try {
		const res = await fetch(`${BASE_URL}${path}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = await res.text();
		console.log(`${res.ok ? "ok  " : "FAIL"} ${path} ${res.status} ${body}`);
		failed ||= !res.ok;
	} catch (err) {
		console.log(`FAIL ${path} ${(err as Error).message}`);
		failed = true;
	}
}
process.exitCode = failed ? 1 : 0;
