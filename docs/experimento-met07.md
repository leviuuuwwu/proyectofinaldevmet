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
mkdir -p docs/evidencia/met07
T0=$(date -u +%FT%TZ); echo "T0 inicio línea base $T0"

# 1. Línea base: 5 min de carga con escrituras (medir latencia y frescura normales)
RPS=5 DURATION_S=300 WRITES=30 npm run -s load:search | tee docs/evidencia/met07/met07-1-base.json

# 2. Degradación: detener el indexer
kubectl -n search-dev scale deployment/search-indexer --replicas=0
T1=$(date -u +%FT%TZ); echo "T1 indexer detenido $T1"

# 3. Mantener carga y escrituras 6 min (WRITES>0 sin indexer: frescura = no indexado)
RPS=5 DURATION_S=360 WRITES=30 npm run -s load:search | tee docs/evidencia/met07/met07-2-degradado.json

# 4. Mitigación: reanudar el indexer
kubectl -n search-dev scale deployment/search-indexer --replicas=1
T2=$(date -u +%FT%TZ); echo "T2 indexer reanudado $T2"

# 5. Verificación: 5 min de carga; el backlog debe volver a 0 y la alerta resolverse
RPS=5 DURATION_S=300 WRITES=30 npm run -s load:search | tee docs/evidencia/met07/met07-3-recuperado.json
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
| Logs | Loki: `{k8s_namespace_name="search-dev"} \| json \| event="index.applied"` | Ausentes entre T1 y T2 |
| Prueba de carga | `indexFreshnessMs.notIndexed` en `met07-2-degradado.json` | > 0 (no se indexan mientras dure) |

## Resultados (corrida del 2026-11-11 en `search-dev`)

Evidencia en [`docs/evidencia/met07/`](evidencia/met07/):
- `tiempos.txt`: marcas T0 a T3;
- `timeline.log`: una muestra cada ~33 s de Prometheus con [`met07-watch.sh`](../observability/scripts/met07-watch.sh);
- `met07-*.json`: las tres fases de carga;
- `index-status-final.json`;
- capturas `0-`… a `6-`….

La carga entró por `kubectl port-forward` (~120 ms de red en cada solicitud).

| Momento | Hora (UTC) | Desde T1 | Observación |
|---|---|---|---|
| Inicio de la línea base (T0) | 07:29:09 | — | Backlog en 0, sin alertas |
| Indexer detenido (T1) | 07:34:10 | 0:00 | `kubectl scale --replicas=0`; `indexer_pods` pasa a sin serie |
| Antigüedad > 60 s | 07:35:17 | +1:07 | 62 s; crece ~1 s por segundo (23.8 → 62.1 → 92.1 → … → 452.1) |
| Alerta Pending | 07:35:50 | +1:40 | `IndexFreshnessStale=pending` (la regla se evalúa cada 1 min) |
| Alerta Firing | 07:37:27 | **+3:17** | Tras `for: 2m`; dentro de lo previsto (3 a 4 min) |
| Indexer reanudado (T2) | 07:42:00 | +7:50 | 30 eventos pendientes, el más antiguo con 452 s |
| Backlog en 0 | ≤ 07:42:24 | T2 + < 24 s | `oldest_age_s=0.1`; el indexer drenó los 30 eventos al arrancar |
| Alerta Resolved | ≤ 07:42:24 | T2 + < 24 s | `alerts=none`; en `ALERTS{}` el último punto Firing es 07:42:00 (`3-alerta-historial.png`) |
| Fin (T3) | 07:47:00 | — | `/index/status`: `pending 0, failed 0` |

La fase degradada duró 7:50 y no 6:00 porque la prueba de carga, al terminar sus 6 min de
búsquedas, siguió esperando que se indexaran las 30 escrituras hasta su límite de tiempo.

Comparativa antes, durante y después (de los JSON de la prueba de carga y de `timeline.log`):

| Métrica | Línea base | Degradado | Recuperado |
|---|---|---|---|
| Búsquedas enviadas / con error | 1500 / 0 | 1800 / 0 | 1500 / 0 |
| Búsquedas p50 / p95 (ms) | 158.9 / 254.8 | 162.5 / 224.4 | 164.3 / 259.3 |
| Escrituras confirmadas | 30 | 30 (201) | 30 |
| Frescura p50 / p95 (ms) | 923 / 1422 | **n/a: 30 de 30 sin indexar** | 834 / 1250 |
| Antigüedad máxima del backlog (s) | 0.4 | **452.1** | 0.1 |
| Eventos pendientes (máx.) | 1 | 30 | 1 |

Capturas:
- `2-rampa-explore-*.png` y `4-recuperado-explore-drenaje.png`: la rampa y la caída a 0;
- `3-alerta-firing.png`: Prometheus → Alerts;
- `3-alerta-historial.png`: estados Pending y Firing en el tiempo;
- `1-` y `4-…-dashboard.png`: el dashboard de indexación;
- `5-loki-hueco.png`: el conteo por minuto de `index.applied` en Loki muestra el corte entre
  T1 y T2 y el pico del drenaje (37 en 1 min) justo después de T2;
- `5-loki-correlacion.png`: una línea de `index.applied` con su `traceId` (el del indexer) y su
  `linkedTraceId` (el de la solicitud de la API que originó el cambio);
- `6-tempo-indexer-process.png`: un lote del indexer en Tempo, con un `SAVEPOINT` por evento.

## Análisis

- **Síntoma:** las búsquedas no reflejan escrituras confirmadas. Las 30 escrituras de la fase
  degradada respondieron 201, pero ninguna apareció en `/search` hasta T2.
- **Qué no se degradó:** la disponibilidad y la latencia de la búsqueda. Hubo 0 errores en
  5100 búsquedas, y el p95 se mantuvo en ~225–260 ms en las tres fases; las diferencias quedan
  dentro del ruido del port-forward. Se confirman las hipótesis 1 y 2: catálogo y búsqueda no
  dependen del indexer.
- **Señal de detección:** `index_backlog_oldest_age_seconds`. Creció linealmente, a 1 s por
  segundo, desde T1, y `IndexFreshnessStale` pasó a Firing a los 3:17 (hipótesis 3).
- **Hallazgo sobre la instrumentación:** el panel "Eventos pendientes en el outbox" del dashboard
  usa `index_outbox_pending`, que **publica el indexer**. Con el indexer detenido, la serie
  **desapareció** en lugar de crecer (`1-degradado-dashboard-*.png`), y las alertas que dependen
  de ella (`SearchIndexOutboxBacklog`, `SearchIndexerStalled`) **no podían dispararse**. La
  señal que sí detectó la falla la calcula la **API** desde el outbox (`index_backlog_*`), y
  por eso sigue existiendo cuando el componente que falla es justamente el que debería
  reportarla.
  - Acción: el dashboard incorpora los paneles de `index_backlog_*`.
  - Lección: una señal de salud no debe depender solo del proceso que vigila.
- **Mecanismo causal:** sin indexer, nadie consume el outbox. Las escrituras siguen entrando
  porque el outbox se escribe en la misma transacción que el catálogo (ADR 0002).
- **Respuesta:** reanudar el indexer. La alternativa es `POST /admin/reindex`, que reconstruye
  desde el catálogo.
- **Validación (hipótesis 4):**
  - el backlog llegó a 0 menos de 24 s después de T2, sin intervención;
  - la alerta se resolvió en la misma muestra;
  - `/index/status` terminó con `pending 0, failed 0`;
  - en la fase recuperada la frescura volvió a valores normales: p95 de 1.25 s, sin documentos
    sin indexar.

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
