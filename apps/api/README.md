# apps/api — API y worker de indexación

Dueño: Leví. Un paquete y una imagen con dos entrypoints: `dist/api.js` (HTTP, puerto 8080)
y `dist/indexer.js` (worker, salud y métricas en 9090). `migrations/` contiene el SQL plano
que aplica `npm run migrate`.

Requisitos: ESC4-01 a ESC4-09, COM-03, COM-04, COM-05; instrumentación MET-02, MET-03,
MET-04 (span link API → indexer vía `traceparent` del outbox); migraciones expand/contract (5.7).

Prueba aislada: `docker compose up -d db && npm run migrate`, luego `npm run dev:api`,
`npm run dev:indexer` y `npm test`. Contratos: `docs/contracts/`.
