# Requests y límites justificados con consumo observado (DEV-11)

Medición: `kubectl top` en `search-dev` (K3s, VM Standard_B2s_v2: 2 vCPU, 8 GiB), en reposo y
durante `npm run test:load` (20 VUs de búsqueda a ~138 req/s, ráfagas de escritura y un reindex
en medio). Salida cruda: [`top.txt`](top.txt). Resultados de la carga: [`../app/carga.txt`](../app/carga.txt).

La carga entró por `kubectl port-forward svc/search-api`, que fija **un solo Pod**: toda la
carga cayó en `search-api-…-kh8f2`. Es el peor caso por réplica. Con el Ingress de prod, el
Service reparte la carga entre las 2 réplicas.

## Consumo observado contra lo configurado

| Contenedor | Request CPU / mem | Límite CPU / mem | Reposo | Pico con carga | Lectura |
|---|---|---|---|---|---|
| `search-api` (por réplica) | 100m / 128Mi | 500m / 512Mi | 2m / 50–83Mi | **194m** / 93Mi | El pico de CPU es ~2× el request y 39 % del límite: con 138 req/s en una sola réplica, el p95 fue 178 ms y no hubo throttling. La memoria pico es el 73 % del request. |
| `search-indexer` | 100m / ~~128Mi~~ → **192Mi** | 500m / 512Mi | 3m / **121Mi** | 33m / 121Mi | La CPU sobra (~50 eventos/s con 33m). La memoria en reposo ya era el **95 % del request**: se sube a 192Mi (ver abajo). |
| `postgres` | 100m / 192Mi | sin límite de CPU / 384Mi | 9m / 21Mi | **207m** / 59Mi | Sin límite de CPU a propósito: es el cuello compartido y el throttling se traduciría en latencia de toda la búsqueda. La memoria tiene un límite para proteger al nodo. |
| Nodo | — | 2000m / 8 GiB | 188m (9 %) / 4.5 GiB (57 %) | 772m (38 %) / 4.5 GiB (56 %) | La mayor parte de la memoria es el stack de observabilidad (Prometheus, Loki, Tempo, Grafana), no la app. |

## Criterios

- **Request ≈ consumo sostenido con margen.** Es lo que el scheduler reserva y lo que define la
  prioridad de desalojo si el nodo se queda sin memoria. Un Pod que vive por encima de su
  request de memoria es de los primeros en ser desalojado.
- **Límite de CPU ≈ 2–3× el pico.** Absorbe ráfagas sin dejar que una réplica acapare el nodo.
  Por réplica de la API: 194m de pico contra 500m de límite.
- **Límite de memoria muy por encima del pico.** Un OOMKill reinicia el proceso, así que el
  límite está en 512Mi para la app (5× su pico) y en 384Mi para PostgreSQL (6× su pico, con
  margen para `shared_buffers` y el catálogo creciendo).
- **Capacidad del nodo.** Con carga, la CPU usó el 38 % y la memoria el 56 %. La suma de los
  requests de la app es 400m y 640Mi (2 réplicas de la API + indexer + postgres), así que cabe
  con holgura junto al stack de monitoreo. La VM de 4 GiB anterior se quedaba sin memoria (#62).

## Ajuste derivado de la medición

`deploy/base/indexer-deployment.yaml`: la memoria del request del indexer pasa de **128Mi a
192Mi**. Su consumo estable es de 121Mi, más alto que el de la API porque carga el SDK de
OpenTelemetry y mantiene el pool. Con 128Mi quedaba al 95 % del request, sin margen y como
candidato a desalojo si el nodo se quedaba sin memoria. El límite sigue en 512Mi.
