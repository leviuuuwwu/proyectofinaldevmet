# tests — Aceptación, golden y carga

Dueña: Astrid. Pruebas que solo usan HTTP contra `BASE_URL` (`node:test` + `fetch`):
`acceptance/` (contrato de la API), `golden/` (resultados esperados de búsqueda),
`load/` (carga). `smoke.ts` verifica `/healthz`, `/readyz` y `/version`.

Requisitos: COM-01, COM-04, COM-05; pruebas P4-1 a P4-5; condición 5.8.

Prueba aislada: `BASE_URL=http://localhost:8080 npm run test:acceptance` y `npm run smoke`.
