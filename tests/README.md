# tests — Aceptación, golden y carga

Dueña: Astrid. Pruebas que solo usan HTTP contra `BASE_URL` (`node:test` + `fetch`):
`acceptance/` (contrato de la API), `golden/` (resultados esperados de búsqueda),
`load/` (carga). `smoke.ts` verifica `/healthz`, `/readyz` y `/version`.

Requisitos: COM-01, COM-04, COM-05; pruebas P4-1 a P4-5; condición 5.8.

## Aceptación (`acceptance/`)

| Archivo | Cubre |
|---|---|
| `health.test.ts` | `/healthz`, `/readyz`, `/version`, `/metrics`, `X-Correlation-Id`, 404 problem+json |
| `auth.test.ts` | 401 (sin token, inválido, esquema distinto) y 403 por rol en todas las rutas protegidas |
| `catalog.test.ts` | Crear, leer, `PUT` con `If-Match` (200/409/400/404), concurrencia, validación 400, `unpublish` idempotente |
| `indexing.test.ts` | Consistencia eventual: `pending` → `indexed`, visibilidad en `/search`, `index-status`, `/index/status` |
| `search.test.ts` | Texto (stemming, frase exacta, exclusión, `or`), filtros, orden determinista, paginación, validación |
| `reindex.test.ts` | `POST /admin/reindex` (202/409), estado del job, búsquedas durante y después del swap |
| `faults.test.ts` | Fallo de indexación visible y recuperable (opcional, ver abajo) |

`helpers.ts` concentra el cliente HTTP y las esperas con tiempo límite (polling, nunca `sleep` fijo).
Cada prueba crea sus propios datos con una categoría y palabras únicas por ejecución, así que
no depende de lo que ya haya en la base ni choca con otras pruebas.

## Cómo ejecutarlas

```bash
npm run db:reset               # datos limpios (borra el volumen local)
npm run dev:api                # :8080
npm run dev:indexer            # :9090
npm run test:acceptance        # usa BASE_URL=http://localhost:8080 por defecto
npm run smoke
```

Tokens: los de desarrollo (ficticios) de `.env.example`. Se pueden cambiar con `READER_TOKEN`,
`EDITOR_TOKEN` y `ADMIN_TOKEN`.

El script usa `--test-concurrency=1`: los archivos corren uno tras otro porque la
reconstrucción del índice (`reindex.test.ts`) y la inyección de fallos (`faults.test.ts`)
cambian el estado global y se interferirían en paralelo.

### Pruebas de fallos (opcional)

Necesitan el indexer con inyección de fallos (solo `APP_ENV=dev`):

```bash
INDEXER_FAULT_CATEGORY=fault-injection npm run dev:indexer
ACCEPTANCE_FAULTS=1 npm run test:acceptance
```

Sin `ACCEPTANCE_FAULTS=1` se omiten. Cada prueba recupera los documentos que rompe.

## Regresiones cubiertas

- **`reindex.test.ts` → "durante el rebuild toda búsqueda responde 200…"**: durante el swap del
  índice `/search` llegó a responder 200 con `total: 0` (ESC4-08, P4-4; corregido en #44). La prueba
  repite el rebuild 3 veces con búsquedas continuas y exige que nunca se vea un total distinto.

## Pendiente

`golden/` y `load/` (ver plan de pruebas). `npm run test:acceptance` aún no corre en la CI:
necesita base de datos, API e indexer levantados.
