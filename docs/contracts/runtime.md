# Contrato de ejecución

Fuente de verdad para imagen, procesos, puertos y configuración. Cambiarlo requiere PR aprobado
por todos los dueños (CODEOWNERS).

## Procesos

Una imagen, tres comandos (mismo `WORKDIR`, usuario no root):

| Proceso | Comando | Puerto | Endpoints | Despliegue |
|---|---|---|---|---|
| api | `node dist/api.js` | 8080 | API del contrato, `/healthz`, `/readyz`, `/version`, `/metrics` | Deployment `api` |
| indexer | `node dist/indexer.js` | 9090 | `/healthz`, `/readyz`, `/metrics` | Deployment `indexer` |
| migrate | `node dist/migrate.js` | — | — (termina con código 0/≠0) | Job previo al despliegue |

- `/healthz`: proceso vivo; no consulta la base de datos (liveness).
- `/readyz`: base de datos alcanzable (`SELECT 1` con timeout corto); 503 si no (readiness).
- `/metrics` en producción no se expone por Ingress.
- `SIGTERM`: dejar de aceptar trabajo, terminar el lote o las solicitudes en curso y salir con 0
  (antes de `terminationGracePeriodSeconds`).
- Las migraciones siguen el patrón expand/contract: toda migración es compatible con la versión
  anterior de la imagen para permitir rollback (condición 5.7).

## Variables de entorno

| Variable | Proceso | Requerida | Default | Secreto | Validación |
|---|---|---|---|---|---|
| `APP_ENV` | todos | sí | — | no | `dev` \| `prod` |
| `PORT` | api, indexer | no | api `8080`, indexer `9090` | no | entero 1–65535 |
| `DATABASE_URL` | todos | sí | — | **sí** (Secret) | URL `postgres://` o `postgresql://` |
| `AUTH_TOKENS_JSON` | api | sí | — | **sí** (Secret) | JSON `[{sub, role, sha256}]`, `role ∈ reader\|editor\|admin`, `sha256` = 64 hex |
| `LOG_LEVEL` | todos | no | `info` | no | `fatal\|error\|warn\|info\|debug\|trace` |
| `OTEL_SERVICE_NAME` | api, indexer | no | `search-api` / `search-indexer` | no | texto |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | api, indexer | no | vacío = trazas desactivadas | no | URL http(s) del OTLP/HTTP |
| `INDEXER_BATCH_SIZE` | indexer | no | `100` | no | entero 1–1000 |
| `INDEXER_POLL_MS` | indexer | no | `1000` | no | entero 50–60000 |
| `INDEXER_MAX_ATTEMPTS` | indexer | no | `5` | no | entero 1–100 |

`AUTH_TOKENS_JSON` contiene solo hashes SHA-256 de tokens ficticios. La API calcula el SHA-256 del
token recibido y lo compara con cada entrada usando `crypto.timingSafeEqual` (tiempo constante).
Los tokens en claro nunca se guardan ni se registran.

**Arranque:** si la configuración es inválida, el proceso registra qué variables fallan (nombre y
regla, nunca el valor) y termina con código 1 antes de abrir puertos.

## Build e imagen

- Build args: `GIT_SHA` (40 hex) y `BUILT_AT` (ISO 8601 UTC), que el Dockerfile exporta
  también como `ENV` con el mismo nombre (fuera de la imagen valen `unknown`). Se exponen en `/version`
  (`commit`, `builtAt`; `version` viene de `apps/api/package.json`), en la métrica
  `app_build_info` y en las etiquetas OCI `org.opencontainers.image.revision` y
  `org.opencontainers.image.created`.
- Imagen: `ghcr.io/<owner>/search-api:<git-sha>` (sin `latest` en despliegues).
- Imagen base fijada por digest.

## Ambientes

| Ambiente | Namespace | `APP_ENV` | Promoción |
|---|---|---|---|
| Desarrollo / validación | `search-dev` | `dev` | automática desde `main` |
| Producción | `search-prod` | `prod` | manual con aprobación del environment |

Cada ambiente tiene su propia base de datos y sus propios Secrets; la versión activa se
verifica con `GET /version`.
