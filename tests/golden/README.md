# tests/golden â€” Resultados esperados de bÃºsqueda

DueÃ±a: Astrid. Verifica `GET /search` contra resultados **calculados sin la API ni PostgreSQL**.

Requisitos: ESC4-03, ESC4-04, ESC4-05, ESC4-10; pruebas P4-1 y P4-3; condiciÃ³n 5.8.

## CÃ³mo funciona

| Archivo | Papel |
|---|---|
| `dataset.ts` | 2,000 documentos deterministas (semilla 42, mismo generador que `tools/datagen`) mÃ¡s cambios fijos: 1 de cada 20 se actualiza y 1 de cada 20 se despublica. |
| `oracle.ts` | OrÃ¡culo independiente: calcula en JavaScript quÃ© documentos debe devolver cada consulta, su `total` y el orden por fecha. No reproduce `rank`, que depende de PostgreSQL. |
| `queries.ts` | 41 consultas: categorÃ­a, etiquetas (una, dos y tres), texto, `or`, `-excluir`, combinaciones y sin resultados. |
| `expected.json` | Resultados esperados, **comprometidos en el repo**. Salen del orÃ¡culo, nunca de la API. |
| `search.golden.test.ts` | Carga el conjunto por HTTP, espera a que el Ã­ndice converja y compara cada consulta con el fixture. |
| `update-expected.ts` | Regenera `expected.json` desde el orÃ¡culo. |

QuÃ© se comprueba en cada consulta: `total`; con `sort=date`, el orden exacto (los empates de fecha se
desempatan por `id`, que es aleatorio, asÃ­ que dentro de una misma fecha se compara el conjunto y que
los `id` vayan ascendentes); con `sort=relevance`, el mismo conjunto y `rank` no creciente.
AdemÃ¡s: las categorÃ­as particionan el conjunto y la paginaciÃ³n recorre el mismo orden con
`pageSize` 1, 7, 20 y 50.

El stemming en espaÃ±ol junta singular y plural (`incidente` = `incidentes`). El orÃ¡culo lo
modela solo para ese par (`STEM_GROUPS` en `oracle.ts`); el resto del vocabulario de las
consultas tiene una sola forma en el corpus.

## CÃ³mo ejecutarlo

```bash
npm run dev:api          # :8080
npm run dev:indexer      # :9090
npm run test:golden      # usa BASE_URL=http://localhost:8080 por defecto
```

No necesita base limpia: cada ejecuciÃ³n marca sus documentos con una etiqueta Ãºnica y todas las
consultas la incluyen. Aun asÃ­, `npm run db:reset` antes da la corrida mÃ¡s reproducible.
Tarda unos 30 segundos (carga 2,000 documentos y espera al indexer).

## CuÃ¡ndo regenerar `expected.json`

Solo si cambias a propÃ³sito el conjunto de datos, las consultas o el orÃ¡culo:

```bash
node tests/golden/update-expected.ts && npx biome format --write tests/golden
```

Revisa el diff: un cambio no intencionado en el generador de `tools/datagen` tambiÃ©n cambia este
fixture, y la prueba "el fixture estÃ¡ al dÃ­a con el orÃ¡culo" falla para avisarlo.

## LÃ­mites

- No cubre fallos de indexaciÃ³n ni reconstrucciÃ³n (ver `tests/acceptance/`).
- No corre en la CI: necesita base de datos, API e indexer levantados.
