# observability — Dashboards, reglas y valores Helm

Dueños: Astrid (`dashboards/`, `rules/`) y Daniela y Ricardo (`helm-values/`). Los dashboards
(≥ 6 paneles) y las reglas de alerta (≥ 2, como PrometheusRule) usan las métricas de
`docs/contracts/telemetry.md`; `helm-values/` versiona cert-manager, kube-prometheus-stack,
Loki, Tempo y OTel Collector.

Requisitos: MET-01, MET-03, MET-05, MET-06, MET-07; Anexo II puntos 6, 7 y 9.

Prueba aislada: `promtool test rules` y `promtool check rules` sobre `rules/`; JSON de dashboards
con `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" <archivo>`.
