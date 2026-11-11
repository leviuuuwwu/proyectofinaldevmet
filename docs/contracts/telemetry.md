# Contrato de telemetría

Fuente de verdad para métricas, logs y trazas. Dashboards y alertas solo usan lo definido aquí.
Cambiarlo requiere PR aprobado por todos los dueños (CODEOWNERS).

## Correlación

- `correlationId`: se toma del encabezado `X-Correlation-Id` si cumple `^[A-Za-z0-9-]{8,64}$`;
  si no, se genera un UUID. Se devuelve en el encabezado `X-Correlation-Id`, en los cuerpos
  problem+json y en cada log de la solicitud.
- Trazas: W3C `traceparent`. La API guarda el `traceparent` del span `outbox.enqueue` en la fila
  del outbox; el span `indexer.process` lo referencia con un **span link** (no como padre), porque
  el procesamiento es asíncrono y puede agrupar eventos de varias solicitudes.
- Los logs emitidos dentro de un span incluyen `traceId` y `spanId`.

## Métricas (`prom-client`)

Unidades en el nombre (segundos, `_total`). Etiquetas de baja cardinalidad: **nunca** id de
documento, texto de consulta, token ni usuario. Cada proceso expone las suyas en su `/metrics`;
el scrape por defecto es cada 15 s.

| Nombre | Tipo | Etiquetas | Proceso | Definición |
|---|---|---|---|---|
| `http_server_request_duration_seconds` | histogram | `route, method, status_class` | api | Duración de cada solicitud HTTP. `route` es la plantilla (`/documents/:id`), `status_class` ∈ `2xx…5xx`. Buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5 |
| `search_requests_total` | counter | `result` (`ok\|client_error\|server_error`) | api | Solicitudes a `/search` por resultado |
| `catalog_writes_total` | counter | `op` (`create\|update\|unpublish`), `result` (`ok\|client_error\|conflict\|server_error`) | api | Escrituras al catálogo |
| `index_outbox_pending` | gauge | — | indexer | Filas del outbox sin procesar (medido en cada ciclo) |
| `index_lag_seconds` | histogram | `op` (`upsert\|delete`) | indexer | Desde `outbox.created_at` (commit en catálogo) hasta aplicado en el índice. Buckets: 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300 |
| `index_events_processed_total` | counter | `result` (`applied\|stale_skipped\|error`) | indexer | Eventos del outbox procesados |
| `reindex_runs_total` | counter | `result` (`succeeded\|failed`) | api | Reconstrucciones terminadas |
| `reindex_duration_seconds` | histogram | `result` (`succeeded\|failed`) | api | Duración de la reconstrucción. Buckets: 1, 2, 5, 10, 30, 60, 120, 300, 600 |
| `app_build_info` | gauge (= 1) | `version, commit, component` (`api\|indexer`) | ambos | Versión en ejecución |

Además se exponen las métricas por defecto de `prom-client` (CPU, memoria, event loop) con el
prefijo estándar, para relacionarlas con las de aplicación (MET-03).

## Logs (pino, JSON, una línea por evento)

| Campo | Descripción |
|---|---|
| `time` | ISO 8601 UTC |
| `level` | `fatal\|error\|warn\|info\|debug\|trace` |
| `component` | `api` \| `indexer` \| `migrate` |
| `event` | nombre del evento (tabla siguiente) |
| `msg` | texto breve en inglés |
| `correlationId` | id de la solicitud que originó la operación (si existe) |
| `traceId`, `spanId` | contexto de traza activo (si existe) |
| `docId` | documento afectado (permitido en logs, nunca en métricas) |
| `linkedTraceId` | solo indexer: `traceId` de la solicitud de la API que escribió el evento (del `traceparent` del outbox); une los logs de ambos componentes |
| `outcome` | `success` \| `failure` \| `skipped` |
| `durationMs` | duración de la operación, cuando aplica |

Prohibido registrar: `Authorization`, tokens, `DATABASE_URL`, cuerpos completos de solicitud o
respuesta y el texto de búsqueda completo.

| Evento | Proceso | Nivel | Cuándo |
|---|---|---|---|
| `catalog.write` | api | info | Escritura confirmada en `documents` (incluye `docId`, `outcome`) |
| `outbox.enqueued` | api | debug | Fila insertada en el outbox en la misma transacción |
| `index.applied` | indexer | info | Evento aplicado al índice (`docId`, `durationMs`) |
| `index.failed` | indexer | error | Error al aplicar; se incrementa `attempts` y se guarda `last_error` |
| `index.stale_skipped` | indexer | debug | Evento con `version <= indexed_version` ignorado |
| `indexer.idle` | indexer | debug | Ciclo sin eventos procesados (`reason`: `no_pending_events` \| `reindex_in_progress`) |
| `reindex.started` | api | info | Inicio de reconstrucción (`jobId`) |
| `reindex.finished` | api | info/error/warn | Fin de reconstrucción (`outcome`, `durationMs`, documentos); `warn` con `interrupted` al marcar jobs huérfanos como fallidos al arrancar |
| `auth.rejected` | api | warn | 401 o 403 (motivo y rol, nunca el token) |
| `request.failed` | api | error | Respuesta 5xx (incluye `correlationId`) |
| `config.invalid` | todos | fatal | Configuración inválida al arrancar (solo nombres de variables) |
| `db.connection_lost` | api, indexer | warn | Se cayó una conexión inactiva a PostgreSQL (p. ej. reinicio, `57P01`); el proceso sigue y se reconecta en la siguiente consulta |
| `process.stopping` | api, indexer | info | Señal de terminación recibida (`SIGTERM`/`SIGINT`) |
| `migration.applied` | migrate | info | Migración aplicada (`migration`, `durationMs`) |
| `migration.finished` | migrate | info | Esquema al día (`applied` = cantidad aplicada) |
| `migration.failed` | migrate | error | Migración revertida; el proceso termina con código 1 |

## Trazas (OpenTelemetry, exportador OTLP/HTTP)

Instrumentación automática: HTTP (`@opentelemetry/instrumentation-http`), Fastify (`@fastify/otel`)
y PostgreSQL (`@opentelemetry/instrumentation-pg`, solo dentro de un span padre: el sondeo inactivo
del indexer y `/readyz` no generan trazas; `/healthz`, `/readyz` y `/metrics` tampoco). Spans manuales:

| Span | Proceso | Relación | Atributos |
|---|---|---|---|
| `catalog.write` | api | hijo del span HTTP | `catalog.op`, `document.id`, `document.version` |
| `outbox.enqueue` | api | hijo de `catalog.write` | `document.id`, `document.version` |
| `indexer.process` | indexer | raíz por lote, con un **span link** por cada `traceparent` del lote | `indexer.batch_size`, `indexer.applied`, `indexer.stale_skipped`, `indexer.errors` |
| `search.query` | api | hijo del span HTTP | `search.has_text`, `search.filters`, `search.page`, `search.page_size`, `search.total` (nunca el texto) |
| `reindex.run` | api | raíz, con link al span HTTP que la inició | `reindex.job_id`, `reindex.documents` |

Muestreo: `parentbased_always_on` en dev; en prod se documenta la tasa usada en el ADR correspondiente.
