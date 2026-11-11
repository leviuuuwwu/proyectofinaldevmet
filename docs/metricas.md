# Métricas, SLIs y SLOs — Escenario 4

Cubre MET-01, MET-03, MET-06 y los puntos 1, 2, 4, 7 y 9 del Anexo II. Contrato de señales en
`docs/contracts/telemetry.md`; reglas en `observability/rules/`; experimento en
`docs/experimento-met07.md`.

## 1. Preguntas operativas

| # | Pregunta | Decisión que permite |
|---|---|---|
| P1 | **¿Cuánto tardan los cambios confirmados en ser visibles en las búsquedas?** | Ajustar `INDEXER_POLL_MS` y `INDEXER_BATCH_SIZE`, o escalar el indexer; decidir cuándo un retraso es un incidente |
| P2 | **¿Qué impacto tienen la indexación y la reconstrucción sobre la latencia y los errores de búsqueda?** | Programar `POST /admin/reindex` fuera de horas de demo, o dimensionar CPU/memoria de la API y PostgreSQL |
| P3 | **¿El indexer está acumulando trabajo o fallando?** | Intervenir: reanudar el indexer, corregir los documentos con error o lanzar una reconstrucción |
| P4 | **¿Los workloads caben en el nodo?** | Ajustar requests y límites (DEV-11) o cambiar el tamaño de la VM (DEV-14) |

## 2. Catálogo de indicadores (MET-01)

Recolección: Prometheus raspa `/metrics` cada **15 s** (PodMonitor `search-app`). Etiquetas de baja
cardinalidad: nunca id de documento, texto de consulta, token ni usuario. Las series se separan por
`namespace` (`search-dev` / `search-prod`).

| Indicador | Unidad | Fuente | Cálculo (PromQL) | Propósito |
|---|---|---|---|---|
| Tasa de búsquedas | req/s | `http_server_request_duration_seconds_count{route="/search"}` | `sum by (namespace) (rate(...[5m]))` | Volumen (denominador de los SLI) |
| Error de búsqueda | fracción | ídem, `status_class="5xx"` | regla `search:errors:ratio_rate5m` | SLI 1, P2 |
| Latencia de búsqueda p95 | s | `http_server_request_duration_seconds_bucket{route="/search"}` | `histogram_quantile(0.95, sum by (namespace, le) (rate(..._bucket[5m])))` | SLI 3, P2 |
| Resultado de búsquedas | req/s | `search_requests_total{result}` | `sum by (namespace, result) (rate(...[5m]))` | Distinguir errores del cliente y del servidor |
| Escrituras al catálogo | req/s | `catalog_writes_total{op,result}` | `sum by (namespace, op, result) (rate(...[5m]))` | Conflictos (409) y fallos de escritura |
| Retraso de indexación | s | `index_lag_seconds` (indexer) | p95: `histogram_quantile(0.95, sum by (namespace, le) (rate(index_lag_seconds_bucket[5m])))` | SLI 2, P1 |
| Antigüedad del backlog | s | `index_backlog_oldest_age_seconds` (API) | `max by (namespace) (...)` | P1/P3; sigue creciendo con el indexer caído |
| Backlog por estado | eventos | `index_backlog_events{state}` (API) | `max by (namespace, state) (...)` | P3 (pendientes y fallidos) |
| Eventos procesados | eventos/s | `index_events_processed_total{result}` | `sum by (namespace, result) (rate(...[5m]))` | Aplicados vs. `stale_skipped` vs. `error` |
| Reconstrucciones | duración en s | `reindex_runs_total`, `reindex_duration_seconds` | `increase(reindex_runs_total[1h])`, `..._sum / ..._count` | P2 (correlacionar con latencia) |
| CPU por contenedor | cores | cAdvisor `container_cpu_usage_seconds_total` | `sum by (namespace, container) (rate(...{container!=""}[5m]))` | P4, relación con requests/límites (MET-03) |
| Memoria por contenedor | bytes | cAdvisor `container_memory_working_set_bytes` | `max by (namespace, container) (...{container!=""})` | P4; un límite por debajo de esto termina en OOMKilled |
| Versión en ejecución | — | `app_build_info{version,commit,component}` | `max by (namespace, component, commit) (app_build_info)` | Saber qué commit corre en cada ambiente (DEV-04) |

## 3. SLIs

| | SLI 1 — Disponibilidad de búsqueda | SLI 2 — Frescura del índice (propio del escenario) | SLI 3 — Latencia de búsqueda |
|---|---|---|---|
| Población | Solicitudes `GET /search` que llegan a la API | Eventos del outbox **aplicados** al índice | Solicitudes `GET /search` respondidas |
| Bueno / total | Respuestas no-5xx / todas | Eventos con retraso ≤ 5 s / eventos aplicados | Respuestas en ≤ 250 ms / todas |
| PromQL (bueno/total) | `1 - search:errors:ratio_rate5m` | `sum(rate(index_lag_seconds_bucket{le="5"}[w])) / sum(rate(index_lag_seconds_count[w]))` | `sum(rate(http_server_request_duration_seconds_bucket{route="/search",le="0.25"}[w])) / sum(rate(..._count{route="/search"}[w]))` |
| Ventana | 7 días (prueba: 1 h) | 7 días (prueba: 1 h) | 7 días (prueba: 1 h) |
| Fuente | API (`prom-client`) | Indexer (`prom-client`) | API (`prom-client`) |
| Exclusiones | 4xx (son errores del cliente: validación, auth); `/healthz`, `/readyz`, `/metrics` no cuentan; ventanas sin tráfico | Eventos `stale_skipped` (no requieren trabajo); eventos que **nunca** se aplican, que se cubren con la alerta `IndexFreshnessStale` y no con este SLI | Respuestas 5xx (ya cuentan en el SLI 1) |

Por qué el SLI 2 no basta solo: `index_lag_seconds` solo observa los eventos que se aplican. Si
el indexer se detiene no hay observaciones y el SLI "no empeora". Por eso existe
`index_backlog_oldest_age_seconds`, que calcula la API y que crece mientras nadie procesa.

## 4. SLOs y presupuesto de error

| SLO | Objetivo | Ventana | Presupuesto de error | Justificación |
|---|---|---|---|---|
| **SLO 1 — Disponibilidad** | 99 % de las búsquedas sin 5xx | 7 días | 1 % de las búsquedas. Ej.: con 100,000 búsquedas en la semana se admiten 1,000 con error. Ventana de prueba de 1 h a 10 req/s = 36,000 búsquedas → 360 | Un solo nodo y una sola réplica (sin alta disponibilidad, 4.2): 99.9 % no es defendible; 99 % deja margen para reinicios de Pod y despliegues |
| **SLO 2 — Frescura** | 95 % de los eventos aplicados en ≤ 5 s | 7 días | 5 % de los eventos. Ej.: con las 2,100 escrituras del conjunto de prueba (2,000 + 100) se admiten 105 con retraso > 5 s | Con `INDEXER_POLL_MS=1000` el retraso típico es de 0.1–1.2 s (medido localmente: p50 117 ms, máx. 231 ms con poll de 200 ms). 5 s absorbe lotes grandes y pausas por reconstrucción; el 5 % restante cubre la ventana de reindex y los reinicios del indexer |

Cálculo del presupuesto consumido (ventana `W`):
`consumido = (1 - SLI_W) / (1 - objetivo)`. Por ejemplo, con un SLI 1 de 99.6 % en la semana:
`(1 - 0.996) / 0.01 = 40 %` del presupuesto.

## 5. Alertas

Definidas en `observability/rules/search.rules.yaml` y probadas con `npm run test:rules`
(promtool; los casos cubren disparo, no disparo y recuperación).

| Alerta | Tipo | Condición | Ventana / `for` | Justificación | Posibles falsos positivos |
|---|---|---|---|---|---|
| `SearchErrorBudgetBurn` (critical) | Degradación de SLI | Error de búsqueda > 14.4 × 1 % en 5 min **y** en 1 h, con > 0.05 req/s | 5 min + 1 h, `for: 2m` | Quemar el presupuesto 14.4 veces más rápido de lo sostenible gasta el ~8.6 % del presupuesto semanal en 1 h. La ventana larga evita alertar por un pico aislado; la corta permite detectarlo en minutos | Muy poco tráfico (por eso el mínimo de 0.05 req/s); un despliegue con la base caída unos segundos queda por debajo del umbral de 1 h |
| `IndexFreshnessStale` (warning) | Síntoma operativo | Evento pendiente más antiguo > 60 s | `for: 2m` | Un cambio confirmado que no aparece en 3 min ya es visible para el usuario (P1/P3). 60 s está muy por encima del retraso normal (< 2 s), así que no salta en operación normal | Durante `POST /admin/reindex` el indexer pausa; con miles de documentos el backlog podría superar 60 s. Mitigación: la reconstrucción tarda ~40 ms con 1,800 documentos, por lo que con estos volúmenes no ocurre |
| `IndexEventsFailed` (warning) | Síntoma operativo | Eventos con error > 0 | `for: 5m` | Un evento que agotó sus reintentos no se resuelve solo (ESC4-09) | Un error transitorio que se reintenta con éxito antes de 5 min no alerta, a propósito |

Detección esperada de `IndexFreshnessStale` tras detener el indexer: 60 s de umbral + 2 min de
`for` + hasta 15 s de scrape + 1 min de evaluación de reglas ≈ **3–4 min**.

## 6. Consultas de investigación

**Prometheus**
```promql
# P1 — retraso p95 de indexación y antigüedad del backlog
histogram_quantile(0.95, sum by (namespace, le) (rate(index_lag_seconds_bucket[5m])))
max by (namespace) (index_backlog_oldest_age_seconds)

# P2 — latencia p95 de búsqueda alrededor de una reconstrucción
histogram_quantile(0.95, sum by (namespace, le) (rate(http_server_request_duration_seconds_bucket{route="/search"}[1m])))
increase(reindex_runs_total[5m])

# P3 — qué está haciendo el indexer
sum by (namespace, result) (rate(index_events_processed_total[5m]))
max by (namespace, state) (index_backlog_events)

# P4 — consumo frente a requests y límites
max by (namespace, container) (container_memory_working_set_bytes{namespace=~"search-.*", container!=""})
sum by (namespace, container) (rate(container_cpu_usage_seconds_total{namespace=~"search-.*", container!=""}[5m]))
```

**Loki** (logs JSON de pino; requiere que el collector envíe los logs de los pods a Loki)
```logql
# Seguir una solicitud: todos los logs de un correlationId
{k8s_namespace_name="search-dev"} | json | correlationId="<id>"
# Del API al indexer: el traceId de catalog.write es el linkedTraceId de index.applied
{k8s_namespace_name="search-dev"} | json | event="index.applied" | linkedTraceId="<traceId>"
# Fallos de indexación con su error
{k8s_namespace_name="search-dev"} | json | event="index.failed" | line_format "{{.docId}} {{.err_message}}"
```

**Tempo** (TraceQL)
```traceql
{ resource.service.name = "search-indexer" && name = "indexer.process" }
{ resource.service.name = "search-api" && name = "catalog.write" }
```
El span `indexer.process` tiene **links** a los spans `outbox.enqueue` de la API (no es hijo:
el procesamiento es asíncrono y un lote agrupa varias solicitudes).

## 7. Instrumentación y límites

- **Frecuencia:** scrape cada 15 s; reglas cada 1 min. Las alertas no pueden detectar nada más
  rápido que eso.
- **Cardinalidad:** `route` usa la plantilla (`/documents/:id`), no la URL; `status_class`
  agrupa los códigos. Series de la API ≈ rutas (12) × métodos × 5 clases × buckets: unas
  cientos por namespace.
- **Trazas:** muestreo `parentbased_always_on` (100 %): con el tráfico del proyecto el costo es
  despreciable; en producción real se bajaría.
- **Backlog en la API:** una consulta al outbox por scrape (usa el índice parcial del outbox). Si
  la base está caída, las series desaparecen en vez de reportar valores viejos.
- **Limitación:** un solo nodo. Si la VM cae, se pierde también la observabilidad; las alertas
  no notifican fuera del clúster (no hay Alertmanager con receptor externo configurado).

## 8. Paneles sugeridos para el dashboard

Para el dashboard de Grafana (≥ 6 paneles, Anexo II punto 6), todos con `namespace` como variable:

| Panel | Consulta | Unidad |
|---|---|---|
| Búsquedas por resultado | `sum by (result) (rate(search_requests_total{namespace="$ns"}[5m]))` | req/s |
| Latencia de búsqueda p50/p95/p99 | `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{namespace="$ns",route="/search"}[5m])))` | s |
| Error de búsqueda vs. SLO | `search:errors:ratio_rate5m{namespace="$ns"}` con umbral 0.01 | % |
| Frescura: retraso p95 y antigüedad del backlog | `histogram_quantile(0.95, ...index_lag_seconds_bucket...)` y `index_backlog_oldest_age_seconds` | s |
| Backlog por estado | `index_backlog_events{namespace="$ns"}` | eventos |
| Eventos procesados por resultado | `sum by (result) (rate(index_events_processed_total{namespace="$ns"}[5m]))` | eventos/s |
| CPU y memoria vs. límites | cAdvisor (§6, P4) | cores / bytes |
| Versión desplegada | `app_build_info{namespace="$ns"}` (tabla: commit, componente) | — |

## 9. Cómo se restablece la observabilidad

Todo está versionado; nada depende de clics no documentados (Anexo II punto 9):

1. Stack (Prometheus, Grafana, Loki, Tempo, OTel Collector, cert-manager, ingress-nginx):
   `infra/scripts/platform-install.sh` con los values de `observability/helm-values/` e
   `infra/helm-values/`.
2. Recolección de la app: `deploy/monitoring/pod-monitor.yaml`, que el workflow de despliegue aplica en cada ambiente cuando el CRD `PodMonitor` existe (si no, deja un aviso en el resumen).
3. Trazas: `OTEL_EXPORTER_OTLP_ENDPOINT` en el ConfigMap `app-config` de cada overlay.
4. Alertas: `observability/rules/prometheusrule.sh | kubectl apply -f -`.
5. Dashboard: JSON en `observability/dashboards/`, cargado como ConfigMap con la etiqueta
   `grafana_dashboard: "1"` (el sidecar de Grafana de kube-prometheus-stack lo importa).
