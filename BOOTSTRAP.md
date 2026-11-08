# BOOTSTRAP — Día 0 (tarea única)

Objetivo: dejar el monorepo listo para que los cuatro integrantes trabajen en
paralelo: estructura, seguridad base, contratos y un esqueleto ejecutable.
NO implementes la lógica de negocio (catálogo, indexer, búsqueda): solo stubs.
Sigue CLAUDE.md. Ejecuta fase por fase y detente al final de cada una con un
resumen de 3 líneas para que yo revise.

## Fase 0 — Verificar entorno

Comprueba `node -v` (24.x), `npm -v`, `docker version`, `gh auth status`,
`git remote -v`. Si algo falta, detente y dime qué instalar. No instales nada global.

## Fase 1 — Seguridad base

1. `.npmrc`:
   ```
   ignore-scripts=true
   save-exact=true
   engine-strict=true
   audit-level=high
   fund=false
   ```
2. `.node-version` con la versión 24 instalada.
3. `.gitignore`: `node_modules/ dist/ coverage/ .env* !.env.example *.tfstate* .terraform/ *.tfvars !*.tfvars.example kubeconfig* *.pem *.key`.
4. `.claude/settings.json`:
   ```json
   {
     "permissions": {
       "deny": [
         "Read(./.env)", "Read(./.env.*)", "Read(./**/*.tfstate)", "Read(./**/kubeconfig*)",
         "Read(./**/*.pem)", "Read(./**/*.key)",
         "Bash(curl:*)", "Bash(wget:*)", "Bash(npm publish:*)", "Bash(git push --force:*)",
         "Bash(terraform apply:*)", "Bash(terraform destroy:*)"
       ],
       "ask": ["Bash(npm install:*)", "Bash(npm i:*)", "Bash(npx:*)", "Bash(kubectl delete:*)", "Bash(git push:*)"]
     }
   }
   ```
5. `.env.example` con las variables de `runtime.md` y valores ficticios.

## Fase 2 — Scaffolding con npm (no escribas package.json a mano)

```bash
BEFORE=$(node -e "console.log(new Date(Date.now()-14*864e5).toISOString().slice(0,10))")
npm init -y
npm pkg set private=true type=module engines.node=">=24 <25"
npm pkg set 'workspaces[0]=apps/*' 'workspaces[1]=tests' 'workspaces[2]=tools/*'
npm init -y -w apps/api -w tests -w tools/datagen
```

Dependencias (todas con `--before="$BEFORE"`):

- Raíz (dev): `typescript @types/node @types/pg @biomejs/biome`
- `apps/api`: `fastify pg prom-client @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/sdk-trace-base @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation @opentelemetry/instrumentation-http @opentelemetry/instrumentation-pg @fastify/otel`
- `tests` y `tools/datagen`: ninguna (Node estándar).

Antes de instalar cada una, revisa `npm view <pkg> scripts maintainers` según CLAUDE.md.
Luego: `npx tsc --init` (local) en `apps/api` y ajusta strict/ESM/outDir; `npx biome init` en la raíz.
Termina con `npm audit signatures` y `npm audit`. Reporta el número total de paquetes instalados.

Scripts raíz (`npm pkg set`): `check`, `test`, `test:acceptance`, `migrate`, `dev:api`,
`dev:indexer`, `build`, `smoke`, según CLAUDE.md.

## Fase 3 — Estructura y dueños

```
apps/api/src/{api,indexer,shared}/   apps/api/migrations/        → Leví
infra/                                                            → Integrante 3 (Terraform, K3s, base del clúster)
deploy/{base,overlays/dev,overlays/prod}/   Dockerfile            → Integrante 4
.github/workflows/                                                → Integrante 4 (app) e Integrante 3 (terraform-*.yml)
tests/{acceptance,golden,load}/   tools/datagen/                  → Daniela
observability/{dashboards,rules,helm-values}/                     → Daniela (dashboards, reglas) e Integrante 3 (helm-values)
docs/{contracts,adr,runbooks}/                                    → todos
```

- Un `README.md` de 5–10 líneas por carpeta de dueño: propósito, requisitos que cubre (IDs), cómo probar aislado.
- `.github/CODEOWNERS` con `@leviuuuwwu`, `@danielaguardad00` y `@INTEGRANTE3`, `@INTEGRANTE4` como placeholders; `docs/contracts/` requiere a todos.
- `.github/pull_request_template.md`: requisitos tocados, evidencia, cómo se probó, riesgos.

## Fase 4 — Contratos

### `docs/contracts/openapi.yaml` (OpenAPI 3.1)

Auth: `Authorization: Bearer <token>`. Roles: `reader`, `editor`, `admin`. 401 sin token, 403 sin rol.
Errores: `application/problem+json`. Incluye ejemplos en cada respuesta (el mock los usa).

| Método y ruta | Rol | Respuesta |
|---|---|---|
| GET `/healthz` | — | 200 proceso vivo (no consulta la BD) |
| GET `/readyz` | — | 200 BD alcanzable / 503 |
| GET `/version` | — | `{version, commit, builtAt}` |
| GET `/metrics` | — | Prometheus (en producción no se expone por Ingress) |
| POST `/documents` | editor | 201 `{id, version, indexState:"pending"}` |
| GET `/documents/{id}` | editor | documento del catálogo, cualquier estado |
| PUT `/documents/{id}` | editor | `If-Match: <version>`; 200 / 409 versión obsoleta |
| POST `/documents/{id}/unpublish` | editor | 200 `{id, version, indexState:"pending"}` |
| GET `/documents/{id}/index-status` | editor | `{docId, catalogVersion, indexedVersion, state: pending\|indexed\|failed, lastError, committedAt, indexedAt}` |
| GET `/search` | reader | `q, tags[], category, sort (relevance\|date), page, pageSize≤50` → `{total, page, pageSize, items}` |
| GET `/index/status` | editor | `{pending, failed, oldestPendingAgeSeconds, lastIndexedAt}` |
| POST `/admin/reindex` | admin | 202 `{jobId}` |
| GET `/admin/reindex/{jobId}` | admin | `{state, startedAt, finishedAt, documents, error}` |

Documento: `id uuid; title 1–200; description 0–2000; tags ≤10 de [a-z0-9-]{1,40};
category 1–50; date (ISO 8601); status draft|published|unpublished; version int; createdAt; updatedAt`.

### `docs/contracts/runtime.md`

- Puertos: api `8080`; indexer expone `/healthz`, `/readyz`, `/metrics` en `9090`.
- Variables: `APP_ENV (dev|prod)`, `PORT`, `DATABASE_URL` (Secret), `AUTH_TOKENS_JSON` (Secret:
  `[{sub, role, sha256}]`, hashes de tokens ficticios; comparación en tiempo constante),
  `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `INDEXER_BATCH_SIZE`,
  `INDEXER_POLL_MS`, `INDEXER_MAX_ATTEMPTS`.
- Build: `GIT_SHA` y `BUILT_AT` como build args → `/version`, label OCI y métrica `app_build_info`.
- Imagen: `ghcr.io/<owner>/search-api:<git-sha>`. Namespaces: `search-dev`, `search-prod`.
- Arranque: falla rápido si la configuración es inválida (sin mostrar valores secretos).

### `docs/contracts/telemetry.md`

Métricas (`prom-client`; unidad en el nombre):

| Nombre | Tipo | Etiquetas |
|---|---|---|
| `http_server_request_duration_seconds` | histogram | `route, method, status_class` |
| `search_requests_total` | counter | `result (ok\|client_error\|server_error)` |
| `catalog_writes_total` | counter | `op (create\|update\|unpublish), result` |
| `index_outbox_pending` | gauge | — |
| `index_lag_seconds` | histogram | `op` (de commit en catálogo a aplicado en índice) |
| `index_events_processed_total` | counter | `result (applied\|stale_skipped\|error)` |
| `reindex_runs_total` / `reindex_duration_seconds` | counter / histogram | `result` |
| `app_build_info` | gauge = 1 | `version, commit, component` |

Logs (JSON): `time, level, component (api|indexer), event, msg, correlationId, traceId,
spanId, docId, outcome, durationMs`. Eventos mínimos: `catalog.write`, `outbox.enqueued`,
`index.applied`, `index.failed`, `index.stale_skipped`, `reindex.started`, `reindex.finished`,
`auth.rejected`, `request.failed`.

Spans: `catalog.write` → `outbox.enqueue` (API); `indexer.process` (worker, con span link
al `traceparent` guardado); `search.query`; `reindex.run`.

## Fase 5 — Esqueleto ejecutable (stubs)

- `shared/`: carga y validación de config, logger, init de telemetría (solo lo listado en Fase 2),
  registro de métricas del contrato, auth por roles, helper de problem+json, correlationId.
- `api.ts`: `/healthz`, `/readyz`, `/version`, `/metrics` funcionales; demás rutas del contrato
  registradas con sus schemas y respondiendo 501 problem+json.
- `indexer.ts`: servidor de salud en 9090 y bucle vacío con log `indexer.idle`.
- Migraciones: runner propio mínimo (tabla `schema_migrations`, SQL plano, transaccional) y
  `001_init.sql` con las tablas de CLAUDE.md. Sin ORM ni librería de migraciones.
- `docker-compose.yml`: solo `db` (postgres:17 fijado por digest), volumen nombrado, credenciales de `.env`.
- `tests/acceptance/health.test.ts` con `node:test` contra `BASE_URL`.
- Script `smoke` con `fetch` de Node.

## Fase 6 — CI mínima y mantenimiento

- `.github/workflows/ci.yml`, job llamado `ci`, en `pull_request` y `push` a `main`:
  checkout → setup-node (versión de `.node-version`, cache npm) → `npm ci` → `npm audit signatures`
  → `npm audit --audit-level=high` → `npm run check` → `npm run build` → `npm test`.
  Actions fijadas por SHA (resuelve con `gh api repos/<owner>/<action>/git/ref/tags/<tag>`),
  `permissions: contents: read`, `concurrency` por rama.
- `.github/dependabot.yml`: ecosistemas `npm` y `github-actions`, semanal, `cooldown: default-days: 14`,
  agrupando actualizaciones menores.

## Fase 7 — Verificación

`npm run check && npm run build && npm test`; `docker compose up -d db`; `npm run migrate`;
levanta api e indexer; `npm run smoke`. Corrige hasta que todo pase.

## Fase 8 — Entrega

Rama `chore/dia-0-bootstrap`, commits Conventional, `git push` (pide permiso), `gh pr create`
con la plantilla y la lista de requisitos cubiertos. No hagas merge.
