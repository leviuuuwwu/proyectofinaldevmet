# ADR 0001 — Decisiones del día 0 (bootstrap)

- Estado: aceptado
- Fecha: 2026-11-07
- Requisitos: COM-02, COM-06, DEV-02, MET-04

## 1. Migraciones como tercer comando de la misma imagen

**Contexto.** CLAUDE.md define dos entrypoints (`api`, `indexer`). Las migraciones deben correr
en el clúster antes de desplegar una versión nueva (Job de Kubernetes) y en local.

**Decisión.** `dist/migrate.js` se incluye en la misma imagen y se ejecuta como Job. Sigue
habiendo dos Deployments; `migrate` no es un servicio de larga duración.

**Alternativas descartadas.** Imagen aparte (duplica build y trazabilidad); migrar al arrancar la
API (carrera entre réplicas y acopla readiness con DDL).

## 2. Línea 2.x de OpenTelemetry

**Contexto.** La regla de 14 días deja disponibles `@opentelemetry/api@1.10` y la línea 3.0
(publicadas el 2026-10-20), pero `sdk-trace-node`/`sdk-trace-base` y `@fastify/otel` aún exigen
`api < 1.10` y `core ^2`.

**Decisión.** Fijar una línea coherente: `api@1.9.1`, `sdk-trace-*`/`resources@2.12.0`,
`exporter-trace-otlp-http`/`instrumentation`/`instrumentation-http@0.223.0`,
`instrumentation-pg@0.76.0`, `@fastify/otel@0.21.3` (una sola copia de `api` y `core`).

**Consecuencia.** Migrar a 3.x cuando todos los paquetes la soporten y cumplan los 14 días.
Hallazgo moderado conocido: `minimatch` vía `@fastify/otel` (umbral de auditoría `high`).

## 3. Sin servidor mock separado

**Contexto.** Las pruebas de aceptación deben poder escribirse antes de la lógica de negocio.

**Decisión.** El esqueleto de la API registra todas las rutas del contrato con autenticación y
schemas reales y responde 501 problem+json en las no implementadas. Las pruebas de 401/403/400
funcionan desde el día 0 contra la API real; las positivas pasan a verde al implementar cada ruta.

**Alternativas descartadas.** Prism u otro mock desde OpenAPI (dependencia y árbol nuevos);
mock propio (duplica el contrato y puede divergir).

## 4. Pruebas solo con Node

**Decisión.** Aceptación, golden y carga con `node:test` + `fetch` nativo (CLAUDE.md). La carga
usa concurrencia controlada con `fetch`; no se agregan pytest ni k6.

## 5. TypeScript ejecutado por Node

**Decisión.** Node 24 ejecuta `.ts` directamente (type stripping) en desarrollo y pruebas;
`tsc` compila a `dist/` para la imagen. Se usa `erasableSyntaxOnly` y
`rewriteRelativeImportExtensions`, por lo que los imports relativos llevan extensión `.ts`.
No se agregan `tsx` ni `ts-node`.
