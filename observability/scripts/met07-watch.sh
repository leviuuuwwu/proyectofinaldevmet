#!/usr/bin/env bash
# Registro con hora del experimento MET-07 (docs/experimento-met07.md): cada INTERVAL_S
# consulta Prometheus y escribe la antigüedad del backlog, los eventos pendientes, el
# ratio de error de /search y el estado de las alertas del namespace.
# Uso (con un port-forward a Prometheus en PROM_URL):
#   observability/scripts/met07-watch.sh | tee docs/evidencia/met07/timeline.log
set -uo pipefail
PROM="${PROM_URL:-http://localhost:9090}"
NS="${NS:-search-dev}"
INTERVAL_S="${INTERVAL_S:-30}"

# Valor escalar de una consulta instantánea ("-" si no hay serie).
q() {
	curl -s --get "$PROM/api/v1/query" --data-urlencode "query=$1" | node -e '
		let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
			const r = JSON.parse(s).data?.result ?? [];
			console.log(r.length ? Number(r[0].value[1]).toFixed(1) : "-");
		});'
}

alerts() {
	curl -s "$PROM/api/v1/alerts" | NS="$NS" node -e '
		let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
			const a = (JSON.parse(s).data?.alerts ?? []).filter((x) => x.labels.namespace === process.env.NS);
			console.log(a.map((x) => `${x.labels.alertname}=${x.state}`).join(",") || "none");
		});'
}

while true; do
	age=$(q "max(index_backlog_oldest_age_seconds{namespace=\"$NS\"})")
	pending=$(q "max(index_backlog_events{namespace=\"$NS\",state=\"pending\"})")
	errors=$(q "max(search:errors:ratio_rate5m{namespace=\"$NS\"})")
	indexers=$(q "count(app_build_info{namespace=\"$NS\",component=\"indexer\"})")
	printf '%s oldest_age_s=%s pending=%s search_5xx_ratio=%s indexer_pods=%s alerts=%s\n' \
		"$(date -u +%FT%TZ)" "$age" "$pending" "$errors" "$indexers" "$(alerts)"
	sleep "$INTERVAL_S"
done
