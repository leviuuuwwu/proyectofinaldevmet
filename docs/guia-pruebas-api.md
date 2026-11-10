# Guía de la API para pruebas, datos y observabilidad

Para quien escribe `tests/`, `tools/datagen/`, dashboards y alertas. Contrato completo en
`docs/contracts/openapi.yaml`; semántica en `docs/semantica-indexacion.md`.

## Entorno local

```sh
npm ci
cp .env.example .env          # una vez
npm run db:reset              # borra el volumen, levanta PostgreSQL y migra (datos limpios)
npm run dev:api               # :8080
npm run dev:indexer           # :9090 (salud y métricas)
```

`npm run db:reset` destruye los datos locales: úsalo antes de cargar el conjunto determinista
para que los resultados golden sean reproducibles.

## Tokens de desarrollo (ficticios, en `.env.example`)

| Rol | Token | Puede |
|---|---|---|
| reader | `dev-reader-token` | `GET /search` |
| editor | `dev-editor-token` | lo anterior + catálogo e índice (`/documents*`, `/index/status`) |
| admin | `dev-admin-token` | lo anterior + `/admin/reindex*` |

Sin token o token inválido → `401`; rol insuficiente → `403`. Errores siempre
`application/problem+json` con `correlationId` (también en el header `X-Correlation-Id`; puedes
enviar el tuyo, `^[A-Za-z0-9-]{8,64}$`, para encontrar tu prueba en los logs).

## Esperar a que un cambio sea visible en la búsqueda

Las escrituras devuelven `indexState: "pending"`. Antes de buscar, espera:

- **Un documento:** sondea `GET /documents/{id}/index-status` hasta `state === "indexed"`
  (o `"failed"` si estás probando fallos).
- **Un lote** (datagen): sondea `GET /index/status` hasta `pending === 0 && failed === 0`.

Usa un intervalo corto (100–200 ms) y un timeout explícito. Para medir el retraso de indexación
(P4-2, P4-5) toma `committedAt` e `indexedAt` de `index-status`, o el histograma `index_lag_seconds`.

## Garantías de búsqueda (lo que el oráculo puede asumir)

- Solo aparecen documentos `published` cuyo estado es `indexed` (ESC4-05).
- Texto: `websearch_to_tsquery('spanish', q)` sobre **título y descripción** (no etiquetas ni
  categoría). Admite `"frase exacta"`, `-excluir` y `or`. Hay stemming en español
  ("respaldos" encuentra "respaldo"); palabras vacías ("el", "de") no encuentran nada.
- `tags` repetido (`tags=a&tags=b`) exige **todas**; `category` es igualdad exacta.
- Orden **determinista**:
  - `sort=relevance` con `q`: `rank DESC, date DESC, id ASC`.
  - `sort=date`, o sin `q`: `date DESC, id ASC`.
- `total` es el número de coincidencias sin paginar; páginas fuera de rango devuelven `items: []`
  con el `total` correcto. Recorrer todas las páginas da cada resultado exactamente una vez.
- Para un oráculo independiente, lo más robusto es comparar **conjuntos y `total`** con filtros
  y términos controlados, y el **orden exacto** con `sort=date` (calculable sin PostgreSQL). El
  valor de `rank` depende de PostgreSQL; no lo reproduzcas.
- `pageSize` máximo 50; parámetros desconocidos → `400`.

## Provocar fallos (P4-3, MET-06, MET-07)

| Fallo | Cómo | Qué se observa |
|---|---|---|
| Indexer detenido | Detener `npm run dev:indexer` (o escalar el Deployment a 0) | `index_outbox_pending` y `oldestPendingAgeSeconds` crecen; búsquedas siguen `200`; al reanudar todo pasa a `indexed` |
| Error de indexación | Arrancar el indexer con `INDEXER_FAULT_CATEGORY=fault-injection` (solo dev) y crear documentos con `category: "fault-injection"` | `index-status` → `failed` con `lastError`; `/index/status.failed` sube; `index_events_processed_total{result="error"}`; logs `index.failed` |
| Recuperación | Editar el documento a otra categoría, o `POST /admin/reindex` | Vuelve a `indexed`; `failed` baja a 0 |
| Base de datos caída | `docker compose stop db` | `/readyz` → `503` en api e indexer; `/healthz` sigue `200` |

## Señales para dashboards y alertas

Métricas (definición completa en `docs/contracts/telemetry.md`):

| Pregunta | Métrica |
|---|---|
| ¿Cuánto tarda un cambio en ser visible? | `index_lag_seconds` (histograma, por `op`) |
| ¿Hay trabajo acumulado? | `index_outbox_pending` (gauge, indexer) |
| ¿El indexer está fallando? | `rate(index_events_processed_total{result="error"}[5m])` |
| ¿La búsqueda responde bien? | `http_server_request_duration_seconds{route="/search"}`, `search_requests_total{result}` |
| ¿Las escrituras fallan? | `catalog_writes_total{op,result}` |
| ¿Qué versión corre? | `app_build_info{component}` |

Correlación de punta a punta: el log `catalog.write` de la API tiene `traceId`; el log
`index.applied` del indexer tiene `linkedTraceId` con el mismo valor.
