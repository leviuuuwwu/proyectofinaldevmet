# Semántica de escritura e indexación

Responde a la condición 5.2 (consistencia, reintentos y tiempos) y a ESC4-05/06.
Diseño en `docs/adr/0002-indexacion-asincrona-y-reconstruccion.md`.

## Qué es síncrono y qué es asíncrono

| Operación | Modo | Qué garantiza la respuesta 2xx |
|---|---|---|
| `POST /documents`, `PUT /documents/{id}`, `POST /documents/{id}/unpublish` | **Síncrona** sobre el catálogo | El cambio está **confirmado** en `documents` (durable) y su evento está en el outbox. `indexState: "pending"` |
| Reflejo en `GET /search` | **Asíncrona** (indexer) | Nada al responder la escritura. Se cumple cuando `index-status` reporta `indexed` |
| `POST /admin/reindex` | **Asíncrona** (job) | El job quedó **aceptado** (`202` + `jobId`); terminar se consulta en `/admin/reindex/{jobId}` |

"Registro guardado" vs "registro actualizado para búsqueda" se distingue con
`GET /documents/{id}/index-status`:

- `pending`: `catalogVersion > indexedVersion` y sin error registrado.
- `failed`: hay un evento pendiente de ese documento con `lastError`.
- `indexed`: `indexedVersion >= catalogVersion`. **A partir de aquí** `/search` refleja el alta,
  la edición o la despublicación (ESC4-05 se evalúa desde este momento).

## Ventana de riesgo: registro despublicado todavía visible

Entre la respuesta `200` de `unpublish` y el estado `indexed`, el documento **sigue en
`search_documents`** y puede aparecer en búsquedas. Es la consecuencia directa de la consistencia
eventual. Se acota y se hace visible así:

- Duración típica: un ciclo del indexer (`INDEXER_POLL_MS`, 1 s por defecto) más el lote; ver
  `index_lag_seconds{op="delete"}`.
- Si el indexer está detenido, la ventana dura hasta que vuelva; `index_outbox_pending` y
  `oldestPendingAgeSeconds` de `/index/status` lo muestran y alimentan una alerta.
- Quien necesite certeza consulta `index-status` antes de afirmar que ya no aparece.

## Duplicados, desorden y reintentos

- Cada escritura incrementa `documents.version`. El indexer aplica un evento solo si su versión
  es mayor que `index_state.indexed_version`, y aplica el **estado actual** del documento.
  Repetir o desordenar eventos no cambia el resultado; los sobrantes se cuentan en
  `index_events_processed_total{result="stale_skipped"}` y se registran como `index.stale_skipped`.
- Un error de indexación se reintenta en los ciclos siguientes hasta `INDEXER_MAX_ATTEMPTS`; cada
  intento queda en `attempts` y `last_error`. No se pierde: la escritura sigue en el catálogo y se
  resuelve con una versión nueva o con una reconstrucción.
- Si el cliente **no sabe** si su `PUT` se aplicó (timeout), lee el documento: `version` y `ETag`
  dicen si su cambio está. Reintentar con el `If-Match` viejo devuelve `409` en vez de duplicar.
- `unpublish` es idempotente: repetirlo devuelve `200` con la misma versión y no crea eventos.
- `POST /documents` **no** es idempotente: reintentarlo crea otro documento (no hay clave de
  idempotencia en el escenario). Es un efecto duplicado admitido y observable (`catalog_writes_total`).

## Si el indexer o el índice fallan

- **Indexer detenido** (P4-3): las escrituras se siguen confirmando; los eventos esperan en el
  outbox (`pending` crece). Al volver, procesa lo acumulado en orden.
- **Índice dañado o desalineado**: `POST /admin/reindex` lo reconstruye desde `documents`
  (que nunca se modifica, ESC4-08) sin cortar las búsquedas.
- **Reinicio de la API durante una reconstrucción**: la transacción se revierte (el índice viejo
  queda intacto) y el job se marca `failed` (`interrupted`) al arrancar; se puede relanzar.
