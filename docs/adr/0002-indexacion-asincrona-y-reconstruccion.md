# ADR 0002 — Indexación asíncrona con outbox y reconstrucción por swap

- Estado: aceptado
- Fecha: 2026-11-09
- Requisitos: ESC4-05, ESC4-06, ESC4-07, ESC4-08, ESC4-09, COM-06, 5.2

## Contexto

El catálogo (`documents`) es la fuente autoritativa; la búsqueda usa un índice derivado
(`search_documents`). Las escrituras deben confirmarse aunque el indexer esté caído (ESC4-08),
el sistema debe informar qué está pendiente (ESC4-06/09) y el índice debe poder reconstruirse
sin interrumpir las búsquedas (ESC4-07).

## Decisiones

1. **Outbox transaccional.** Cada escritura inserta su evento (`doc_id`, `version`, `op`,
   `traceparent`) en la misma transacción que `documents`. Si la transacción confirma, el evento
   existe; si no, ninguno de los dos. No hay doble escritura ni pérdida de cambios.
2. **Idempotencia por versión, aplicando el estado actual.** El indexer aplica un evento solo si
   `event.version > index_state.indexed_version`, y en ese caso lee la fila **actual** de
   `documents` (no el contenido del evento). Duplicados y eventos fuera de orden convergen al
   mismo resultado; los sobrantes quedan como `stale_skipped`.
3. **Errores visibles.** Un fallo hace `ROLLBACK TO SAVEPOINT` solo de ese evento, incrementa
   `attempts` y guarda `last_error` en el outbox y en `index_state`. Tras `INDEXER_MAX_ATTEMPTS`
   el evento queda sin procesar y visible como `failed` hasta que una versión más nueva se aplique
   o una reconstrucción lo cubra.
4. **Concurrencia.** Lotes con `FOR UPDATE SKIP LOCKED` (varios indexers posibles) bajo un advisory
   lock **compartido**; la reconstrucción toma el mismo lock en modo **exclusivo**.
5. **Reconstrucción por shadow + swap.** Con el lock exclusivo (a nivel de sesión, tomado *antes*
   del snapshot) y en una transacción `REPEATABLE READ`: se crea `search_documents_shadow` desde los
   documentos publicados, se alinea `index_state`, se marcan como procesados los eventos cubiertos
   y se renombran las tablas. Los eventos confirmados después del snapshot tienen versión mayor y
   el indexer los aplica al terminar. `documents` solo se lee.
6. **La reconstrucción corre en el proceso api** (como dice el contrato de telemetría), con estado
   en `reindex_jobs`; un índice único impide dos activas y los jobs huérfanos se marcan `failed` al
   arrancar la API si nadie tiene el lock.

## Consecuencias

- Consistencia eventual entre catálogo y búsqueda, medible (`index_lag_seconds`) y consultable
  por documento (`/documents/{id}/index-status`) y global (`/index/status`).
- Durante una reconstrucción el indexer pausa: `index_outbox_pending` sube y luego baja. Es
  esperado y explicable en el análisis de MET-07.
- Las búsquedas solo esperan el instante del renombrado (milisegundos).

## Alternativas descartadas

- **Escribir el índice desde la API** (síncrono): acopla la disponibilidad de escritura al índice y
  viola la regla de CLAUDE.md.
- **Leer `documents` directamente en `/search`** (sin índice derivado): no cumple el escenario
  (no habría nada que reconstruir ni estado de actualización) y mezcla cargas.
- **`TRUNCATE` + reinsertar** para reconstruir: toma `ACCESS EXCLUSIVE` durante toda la
  transacción y bloquea las búsquedas.
- **Reconstrucción en el indexer**: más robusta ante reinicios de la API, pero cambia el contrato
  de telemetría; se reconsidera si la API escala a varias réplicas con reinicios frecuentes.
- **Cola externa** (Redis, RabbitMQ, Kafka): componente adicional sin requisito que lo exija.
