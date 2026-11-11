# observability — Dashboards, reglas y valores Helm

Dueñas: Astrid (`dashboards/`, `rules/`) y Daniela (`helm-values/`). Los dashboards
(≥ 6 paneles) y las reglas de alerta (≥ 2, como PrometheusRule) usan las métricas de
`docs/contracts/telemetry.md`; `helm-values/` versiona cert-manager, kube-prometheus-stack,
Loki, Tempo y OTel Collector. Las versiones de chart están fijadas en
`infra/scripts/platform-install.sh`, que los instala.

Requisitos: MET-01, MET-03, MET-05, MET-06, MET-07; Anexo II puntos 6, 7 y 9.

Prueba aislada: `promtool test rules` y `promtool check rules` sobre `rules/`; JSON de dashboards
con `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" <archivo>`.

## Dashboards (`dashboards/`)

| Archivo | Tablero | Paneles |
|---|---|---|
| `search-service.json` | Search — Servicio | Tráfico, errores 5xx, latencia p50/p95/p99 de `/search` y por ruta, búsquedas por resultado, escrituras al catálogo, respuestas por clase, memoria, CPU, event loop y versiones desplegadas (16) |
| `search-indexing.json` | Search — Indexación y reconstrucción | Eventos pendientes del outbox, retraso catálogo → índice (p50/p95/p99 y distribución), eventos procesados por resultado, tasa de errores, reconstrucciones y su duración (14) |

Ambos tienen una variable `Entorno (namespace)` (`search-dev`, `search-prod`) y una `Fuente de datos`.
Los umbrales de color de las estadísticas coinciden con los de las alertas.

```bash
kubectl apply -k observability/dashboards     # crea ConfigMaps en `monitoring` con grafana_dashboard=1
```

El sidecar de Grafana (`observability/helm-values/kube-prometheus-stack.yaml`) los carga solo.
Los JSON son la fuente de verdad: lo que se cambie en la interfaz se pierde si no se guarda aquí.

## Reglas de alerta (`rules/`)

`rules/search-alerts.yaml` es un `PrometheusRule` con 8 alertas (3 de API, 5 de indexación). Prometheus
carga cualquier `PrometheusRule` de cualquier namespace (`ruleSelectorNilUsesHelmValues: false`).

| Alerta | Severidad | Condición |
|---|---|---|
| `SearchApiHighErrorRate` | critical | más de 5 % de respuestas 5xx durante 5 min (con tráfico mínimo) |
| `SearchLatencyHigh` | warning | p95 de `/search` > 1 s durante 10 min |
| `SearchProdMetricsMissing` | critical | sin `app_build_info` de la API o del indexer en `search-prod` durante 5 min |
| `SearchIndexLagHigh` | warning | p95 de `index_lag_seconds` > 30 s durante 10 min |
| `SearchIndexOutboxBacklog` | warning | `index_outbox_pending` > 500 durante 10 min |
| `SearchIndexerErrors` | warning | errores de indexación sostenidos durante 5 min |
| `SearchIndexerStalled` | critical | hay eventos pendientes y no se procesa ninguno durante 10 min |
| `SearchReindexFailed` | warning | una reconstrucción terminó en `failed` (últimos 15 min) |

**Los umbrales son supuestos iniciales, no SLOs aprobados**: ajustarlos al catálogo de indicadores (MET-01).

```bash
bash observability/rules/validate.sh          # promtool check + 11 casos de prueba unitaria (requiere Docker)
kubectl apply -f observability/rules/search-alerts.yaml
```

`validate.sh` usa la imagen oficial de Prometheus fijada por digest (v3.5.0). Las pruebas están en
`rules/tests/` y cubren, por alerta, el caso que debe dispararla y el que no.

## Requisitos previos para que funcione en el clúster

- **Scrape:** Prometheus solo ve estas métricas si hay un `ServiceMonitor`/`PodMonitor` que raspe
  `search-api` (puerto `http`, 8080) y `search-indexer` (puerto `metrics`, 9090) en `search-dev` y
  `search-prod`. El NetworkPolicy ya permite el tráfico desde `monitoring`. Las consultas usan la
  etiqueta `namespace` que añade el operador.
- **Contadores:** `prom-client` crea una serie etiquetada con su primer incremento, y `increase()`/
  `rate()` no cuentan ese primer evento. `SearchReindexFailed` lo compensa; los paneles de
  reconstrucciones usan el valor acumulado.
