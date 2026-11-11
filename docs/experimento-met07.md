# Experimento de degradación controlada — indexer detenido (MET-07, 5.11)

Responde a P1 y P3 de `docs/metricas.md`. Es reversible, no borra datos y no consume crédito
extra. Las secciones marcadas con **(completar)** se llenan con los datos reales de la corrida;
no se inventan.

## Hipótesis

Si el indexer se detiene mientras hay escrituras:

1. Las escrituras **se siguen confirmando** (`201`) y las búsquedas **siguen disponibles** (sin
   5xx, latencia sin cambio): el catálogo y la búsqueda no dependen del indexer.
2. La **frescura se degrada linealmente**: `index_backlog_oldest_age_seconds` crece ~1 s por
   segundo y `index_backlog_events{state="pending"}` crece con cada escritura.
3. `IndexFreshnessStale` se dispara entre **3 y 4 min** después de detenerlo (§5 de métricas).
4. Al reanudarlo, el backlog **se drena en segundos** (idempotencia por versión: no hay
   duplicados) y la alerta se resuelve.

## Procedimiento reproducible

Requisitos: app desplegada en `search-dev`, stack de observabilidad y reglas aplicadas, túnel
SSH al clúster (`docs/runbooks/costos-y-reconstruccion.md` §6), tokens de dev (`READER_TOKEN`,
`EDITOR_TOKEN`).

```sh
export BASE_URL=https://<host-de-dev>   # o un port-forward a search-api:8080
mkdir -p evidencia
T0=$(date -u +%FT%TZ); echo "T0 inicio línea base $T0"

# 1. Línea base: 5 min de carga con escrituras (medir latencia y frescura normales)
RPS=5 DURATION_S=300 WRITES=30 npm run test:load | tee evidencia/met07-1-base.json

# 2. Degradación: detener el indexer
kubectl -n search-dev scale deployment/search-indexer --replicas=0
T1=$(date -u +%FT%TZ); echo "T1 indexer detenido $T1"

# 3. Mantener carga y escrituras 6 min (WRITES>0 sin indexer: frescura = no indexado)
RPS=5 DURATION_S=360 WRITES=30 npm run test:load | tee evidencia/met07-2-degradado.json

# 4. Mitigación: reanudar el indexer
kubectl -n search-dev scale deployment/search-indexer --replicas=1
T2=$(date -u +%FT%TZ); echo "T2 indexer reanudado $T2"

# 5. Verificación: 5 min de carga; el backlog debe volver a 0 y la alerta resolverse
RPS=5 DURATION_S=300 WRITES=30 npm run test:load | tee evidencia/met07-3-recuperado.json
curl -s -H "Authorization: Bearer $EDITOR_TOKEN" "$BASE_URL/index/status"
```

## Señales que se recogen

| Señal | Consulta / fuente | Esperado durante la degradación |
|---|---|---|
| Antigüedad del backlog | `max(index_backlog_oldest_age_seconds{namespace="search-dev"})` | Rampa lineal desde T1 |
| Backlog pendiente | `index_backlog_events{namespace="search-dev",state="pending"}` | Sube con cada escritura |
| Alerta | Prometheus → Alerts: `IndexFreshnessStale` | Pending ≈ T1+1 min, Firing ≈ T1+3–4 min, Resolved tras T2 |
| Latencia de búsqueda p95 | §6 P2 de métricas | Sin cambio |
| Error de búsqueda | `search:errors:ratio_rate5m` | 0 |
| Escrituras | `catalog_writes_total{op="create",result="ok"}` | Siguen creciendo |
| Drenaje | `rate(index_events_processed_total{result="applied"}[1m])` | Pico breve después de T2 |
| Logs | Loki: `{namespace="search-dev"} \| json \| event="index.applied"` | Ausentes entre T1 y T2 |
| Prueba de carga | `indexFreshnessMs.notIndexed` en `met07-2-degradado.json` | > 0 (no se indexan mientras dure) |

## Resultados (completar)

| Momento | Hora (UTC) | Observación |
|---|---|---|
| Inicio de la línea base (T0) | | |
| Indexer detenido (T1) | | |
| Alerta Pending | | |
| Alerta Firing | | |
| Indexer reanudado (T2) | | |
| Backlog en 0 | | |
| Alerta Resolved | | |

Comparativa antes / durante / después (de los JSON de la prueba de carga y de Prometheus):

| Métrica | Línea base | Degradado | Recuperado |
|---|---|---|---|
| Búsquedas p95 (ms) | | | |
| Tasa de error | | | |
| Frescura p95 (ms) | | n/a (no indexa) | |
| Antigüedad máxima del backlog (s) | | | |

Adjuntar capturas de la gráfica de `index_backlog_oldest_age_seconds` con T1 y T2 marcados, y de
la alerta en Firing y en Resolved.

## Análisis (completar con la evidencia)

- **Síntoma:** las búsquedas no reflejan escrituras confirmadas.
- **Señal de detección:** `IndexFreshnessStale` y la rampa de la antigüedad del backlog.
- **Mecanismo causal:** sin indexer nadie consume el outbox; las escrituras siguen entrando
  porque el outbox se escribe en la misma transacción que el catálogo (ADR 0002).
- **Respuesta:** reanudar el indexer (o `POST /admin/reindex`, que reconstruye desde el catálogo).
- **Validación:** backlog en 0, alerta resuelta, las búsquedas reflejan los documentos creados
  durante la degradación (`GET /documents/{id}/index-status` → `indexed`).

## Limitaciones

- Un solo nodo y una sola réplica del indexer: no prueba la tolerancia a la pérdida de la VM.
- La detección tiene una granularidad de 15 s (scrape) + 1 min (evaluación de reglas) + `for`.
- La carga es sintética y baja (5 req/s); no representa picos reales.
- Si también cae la API, las series del backlog desaparecen: esa falla la cubre la ausencia de
  `up` y no esta alerta.

## Variante: fallo de indexación en vez de detención

Con `INDEXER_FAULT_CATEGORY=fault-injection` (solo dev) y documentos de esa categoría, los
eventos agotan sus reintentos: se dispara `IndexEventsFailed`, `/index/status` muestra `failed` y
los logs `index.failed` tienen el error. Se resuelve editando la categoría o con
`POST /admin/reindex` (`docs/guia-pruebas-api.md`).
