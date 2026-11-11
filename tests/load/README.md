# tests/load — Carga

Dueña: Astrid. Prueba de carga con `node:test` + `fetch` nativo (ADR 0001: sin k6 ni dependencias).
Mide latencia y errores de `/search`, el caudal y el retraso del indexer, y el comportamiento
durante una reconstrucción del índice.

Requisitos: P4-2, P4-4, P4-5, MET-07; condición 5.8.

## Qué hace

Siembra 300 documentos (no se mide) y ejecuta cuatro escenarios seguidos:

| Escenario | Qué mide | Falla si |
|---|---|---|
| Búsquedas concurrentes (20 usuarios virtuales, 10 s) | req/s, p50/p95/p99 de una mezcla de consultas (texto, categoría, etiquetas, paginación) | hay cualquier error o respuesta inválida, o p95 > `LOAD_MAX_SEARCH_P95_MS` |
| Ráfaga de escrituras (300 documentos, 10 usuarios) | latencia de escritura y **caudal del indexer** (eventos/s); el retraso de la cola se reporta pero no se exige | hay errores, o el outbox no se vacía |
| Escrituras a ritmo constante (10/s, 10 s) | **retraso de indexación** `indexedAt − committedAt` (p50/p95/máx) | hay errores, o p95 > `LOAD_MAX_LAG_P95_S` |
| Carga mixta con reconstrucción en medio (12 s) | búsquedas y escrituras mientras corre `POST /admin/reindex` | hay errores de búsqueda o de escritura, la reconstrucción no termina en `succeeded`, o el outbox no converge |

Las respuestas de búsqueda se validan, no solo su estado: forma del cuerpo, `items` ≤ `pageSize`,
orden por fecha, y que una consulta sin filtros nunca devuelva `total: 0` (así se detecta el
vaciado momentáneo del índice durante el swap, ESC4-08).

Por qué hay dos escenarios de escritura: una ráfaga por encima de la capacidad del indexer genera
cola, y el "retraso" medido es el tamaño de la cola. El retraso real se mide a un ritmo que el
indexer sí sostiene.

## Cómo ejecutarla

```bash
npm run dev:api          # :8080
npm run dev:indexer      # :9090
npm run test:load        # usa BASE_URL=http://localhost:8080 por defecto
```

Tarda cerca de 50 segundos. El informe completo sale como una línea `LOAD_REPORT {json}`; con
`LOAD_REPORT_FILE=informe.json` también se guarda en un archivo (no lo subas al repo).

## Variables

| Variable | Por defecto | Descripción |
|---|---|---|
| `BASE_URL`, `READER_TOKEN`, `EDITOR_TOKEN`, `ADMIN_TOKEN` | local y tokens de desarrollo | Destino y tokens ficticios |
| `LOAD_SEED_DOCS` | 300 | Documentos sembrados |
| `LOAD_SEARCH_VUS` / `LOAD_SEARCH_SECONDS` | 20 / 10 | Usuarios virtuales y duración de la fase de búsqueda |
| `LOAD_WRITE_VUS` / `LOAD_WRITE_DOCS` | 10 / 300 | Usuarios y escrituras de la ráfaga |
| `LOAD_STEADY_RATE` / `LOAD_STEADY_SECONDS` | 10 / 10 | Escrituras por segundo y duración del ritmo constante |
| `LOAD_MIXED_SECONDS` | 12 | Duración de la carga mixta |
| `LOAD_MAX_SEARCH_P95_MS` | 1000 | Umbral de p95 de búsqueda |
| `LOAD_MAX_WRITE_P95_MS` | 2000 | Umbral de p95 de escritura |
| `LOAD_MAX_LAG_P95_S` | 5 | Umbral de p95 del retraso de indexación |
| `LOAD_DRAIN_TIMEOUT_S` | 60 | Tiempo máximo para que el outbox se vacíe |

**Los umbrales por defecto son supuestos para una corrida local, no valores de la rúbrica.**
Ajústalos al SLO real (MET-01) y al entorno. Para el clúster, apunta `BASE_URL` al servicio y sube
`LOAD_SEARCH_VUS`; compara con `index_lag_seconds` y `reindex_duration_seconds` (P4-5).

## Límites

- Los usuarios virtuales son de bucle cerrado: si el servidor se vuelve lento, también baja la
  carga ofrecida (omisión coordinada), así que p99 es una cota inferior.
- La carga sale de una sola máquina y de un solo proceso de Node; no satura un servidor grande.
- Crea documentos en la base sobre la que corre (cientos por ejecución): usar solo en local o dev.
- No corre en la CI: necesita base de datos, API e indexer.
