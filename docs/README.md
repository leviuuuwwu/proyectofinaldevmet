# docs — Contratos, ADR y runbooks

Dueños: todo el equipo. `contracts/` es la fuente de verdad (OpenAPI, runtime, telemetría):
el código se ajusta al contrato y cambiarlo requiere PR aprobado por todos los dueños.
`adr/` registra decisiones de arquitectura (`NNNN-titulo.md`); `runbooks/` describe la
operación (reconstrucción del índice, fallos del indexer, despliegue).

Requisitos: COM-02 y COM-06 (diagrama, ADR, semántica síncrona/asíncrona), DEV-13
(reconstrucción), MET-01 (catálogo de indicadores, SLIs/SLOs) y MET-07 / 5.11 (incidente).

Prueba aislada: el OpenAPI se valida en las pruebas de aceptación contra la API real.
