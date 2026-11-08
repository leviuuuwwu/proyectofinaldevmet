# Proyecto de cátedra — Escenario 4: Búsqueda e indexación

Catálogo de documentos con búsqueda por texto, filtros, orden y paginación.
El catálogo en PostgreSQL es la fuente autoritativa; el índice de búsqueda es
derivado y se actualiza de forma asíncrona. La rúbrica premia requisitos
verificables, reconstrucción y evidencia, no complejidad. No agregues
componentes, dependencias ni abstracciones que no exija un requisito.

## Arquitectura (cambiar solo con un ADR en docs/adr/)

- `apps/api`: un paquete, una imagen, dos entrypoints: `dist/api.js` (HTTP) y
  `dist/indexer.js` (worker). Se despliegan como dos Deployments.
- Tablas:
  - `documents`: fuente; `version int` se incrementa en cada escritura.
  - `outbox`: `doc_id, version, op, traceparent, created_at, processed_at, attempts, last_error`.
  - `index_state`: `doc_id, indexed_version, indexed_at, last_error` (existe aunque el doc esté despublicado).
  - `search_documents`: solo publicados; `tsv tsvector` (config `spanish`) con GIN, más campos filtrables.
  - `reindex_jobs`: estado de reconstrucciones.
- Escritura: `documents` + `outbox` en la MISMA transacción. Nunca escribir el índice desde la API.
- Indexer: lotes con `FOR UPDATE SKIP LOCKED`; aplica solo si `version > indexed_version`
  (idempotente ante duplicados y desorden); despublicar = borrar de `search_documents`;
  errores se registran con `attempts` y `last_error`, no se pierden.
- Reconstrucción: poblar `search_documents_shadow` desde `documents` y hacer swap
  atómico en una transacción; las búsquedas no se interrumpen.
- Búsqueda: `websearch_to_tsquery('spanish', q)`; filtros por `tags` y `category`;
  orden `ts_rank DESC, published_at DESC, id ASC` (determinista); devuelve `total`.
- Estado de indexación: `documents.version` vs `index_state.indexed_version`.
- Métricas con `prom-client`; trazas con OpenTelemetry; logs con pino (incluido en Fastify).
  El `traceparent` se guarda en `outbox` y el span del indexer se enlaza (span link) al de la API.

## Contratos (fuente de verdad)

`docs/contracts/openapi.yaml`, `docs/contracts/runtime.md`, `docs/contracts/telemetry.md`.
El código se ajusta al contrato, no al revés. Cambiar un contrato requiere PR
aprobado por los dueños afectados (ver CODEOWNERS).

## Comandos

- `npm ci` — instalar (nunca `npm install` sin las reglas de abajo)
- `docker compose up -d db` / `npm run migrate` — base local
- `npm run dev:api` / `npm run dev:indexer`
- `npm run check` — Biome + `tsc --noEmit`
- `npm test` — pruebas unitarias (`node:test`)
- `npm run test:acceptance` — pruebas HTTP en `tests/` contra `BASE_URL`
- `npm run smoke` — verifica `/healthz`, `/readyz`, `/version` con fetch de Node

## Seguridad de la cadena de suministro (obligatorio)

Contexto: en 2025 hubo compromisos de paquetes npm muy usados y gusanos que se
propagaban mediante scripts `preinstall`/`postinstall` robando tokens. Asume que
cualquier versión recién publicada puede estar comprometida.

- `.npmrc` tiene `ignore-scripts=true` y `save-exact=true`. No los cambies.
  Si un paquete necesita scripts de instalación, detente y pregunta.
- Toda instalación nueva usa versiones con al menos 14 días de antigüedad:
  `npm install <pkg> --before="$(node -e "console.log(new Date(Date.now()-14*864e5).toISOString().slice(0,10))")"`
- Antes de agregar una dependencia: revisa `npm view <pkg> time maintainers repository scripts`.
  Rechaza paquetes con mantenedor nuevo, sin repositorio o con scripts de instalación.
  Prefiere la librería estándar de Node. Cada dependencia nueva se justifica en el PR.
- Después de instalar: `npm audit signatures` y `npm audit --audit-level=high`.
- `npx` solo con versión fijada (`pkg@x.y.z`). Nunca `curl ... | sh`.
- Prohibido: Playwright, Puppeteer, Cypress o cualquier navegador headless;
  meta-paquetes como `@opentelemetry/auto-instrumentations-node` o `@opentelemetry/sdk-node`;
  ORMs; generadores que traigan árboles grandes de dependencias.
- GitHub Actions: fijadas por SHA completo con comentario de versión;
  `permissions: contents: read` por defecto; nunca `pull_request_target`.
- Imágenes Docker base fijadas por digest.

## Secretos

Nunca en el repo, imágenes, logs ni artefactos. `.env*` solo local y en `.gitignore`.
No leas archivos `.env`, `*.tfstate`, kubeconfigs ni llaves. Cuentas y datos siempre ficticios.

## Convenciones

- Código e identificadores en inglés; documentación en español.
- TypeScript estricto, ESM, Node 24 LTS. Validación con JSON Schema nativo de Fastify (sin zod).
- Errores: `application/problem+json` (RFC 9457) con `correlationId`.
- Logs: campos de `telemetry.md`; nunca registrar `Authorization`, tokens ni cuerpos completos.
- Etiquetas de métricas de baja cardinalidad: nunca id de documento ni texto de consulta.
- Tests: `node:test` + `fetch` nativo. Las pruebas de aceptación solo usan HTTP.
- Commits: Conventional Commits. Cada PR cita los requisitos que toca (ESC4-03, DEV-05, MET-04...).
- Respeta CODEOWNERS: no modifiques carpetas de otro dueño sin que se pida.

## Economía de tokens

- Usa generadores (`npm init`, `tsc --init`, `biome init`) en vez de escribir boilerplate.
- No leas `node_modules/`, `dist/`, `package-lock.json` ni archivos generados.
- Cambios pequeños con edición puntual; no reescribas archivos completos.
- Si una tarea no está clara, pregunta antes de explorar todo el repo.
