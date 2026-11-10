# Arquitectura

Requisitos: COM-02, COM-06. Decisiones en `docs/adr/` (0001 día 0, 0002 indexación y reconstrucción).

## Componentes

```mermaid
flowchart LR
  subgraph clientes[Clientes]
    E[editor / admin]
    R[reader]
  end

  subgraph k3s[K3s · namespace search-dev / search-prod]
    API["api<br/>dist/api.js · :8080"]
    IDX["indexer<br/>dist/indexer.js · :9090"]
    MIG["migrate (Job)<br/>dist/migrate.js"]
  end

  subgraph pg[(PostgreSQL)]
    DOCS[documents<br/>fuente autoritativa]
    OUT[outbox]
    IST[index_state]
    SD[search_documents<br/>índice derivado]
    RJ[reindex_jobs]
  end

  OBS[Prometheus · Loki · Tempo<br/>vía OTel Collector]

  E -- "POST/PUT/unpublish" --> API
  R -- "GET /search" --> API
  API -- "1 transacción: documents + outbox" --> DOCS
  API --> OUT
  API -- "lee" --> SD
  API -- "estado" --> IST
  API -- "reconstrucción (shadow + swap)" --> SD
  API --> RJ
  IDX -- "lotes FOR UPDATE SKIP LOCKED" --> OUT
  IDX -- "lee versión actual" --> DOCS
  IDX -- "upsert / delete" --> SD
  IDX --> IST
  MIG -- "schema_migrations" --> pg
  API -. "métricas, logs, trazas" .-> OBS
  IDX -. "métricas, logs, trazas (span link)" .-> OBS
```

## Responsabilidades

| Componente | Hace | No hace |
|---|---|---|
| **api** | Autenticación por rol, validación con JSON Schema, escrituras al catálogo con su evento de outbox en la **misma transacción**, búsqueda sobre `search_documents`, estado de indexación, reconstrucción administrativa | Nunca escribe el índice en una escritura normal; no procesa el outbox |
| **indexer** | Consume el outbox en lotes, aplica la versión **actual** del documento al índice si es más nueva que `index_state`, registra errores (`attempts`, `last_error`) | No atiende tráfico de usuarios (solo `/healthz`, `/readyz`, `/metrics`) |
| **migrate** | Aplica `apps/api/migrations/NNN_*.sql` en orden, cada una en su transacción, con lock para que no corran dos | No corre al arrancar la API (evita carreras entre réplicas) |
| **PostgreSQL** | Catálogo (fuente de verdad), outbox, índice derivado (`tsvector` en español con GIN) | — |

Una sola imagen y un solo paquete; los tres procesos difieren solo en el comando (`docs/contracts/runtime.md`).

## Flujo de una escritura (asíncrona hacia la búsqueda)

```mermaid
sequenceDiagram
  participant C as Cliente (editor)
  participant A as api
  participant DB as PostgreSQL
  participant I as indexer
  C->>A: PUT /documents/{id} (If-Match: 3)
  A->>DB: BEGIN; UPDATE documents (v4); INSERT outbox (v4, traceparent); COMMIT
  A-->>C: 200 {version: 4, indexState: "pending"}
  Note over C,A: Confirmada en el catálogo; aún no visible en /search
  loop cada INDEXER_POLL_MS
    I->>DB: lote de outbox (SKIP LOCKED, lock compartido)
    I->>DB: si 4 > indexed_version → upsert search_documents, index_state = 4
  end
  C->>A: GET /documents/{id}/index-status
  A-->>C: {catalogVersion: 4, indexedVersion: 4, state: "indexed"}
```

El span `indexer.process` tiene un **link** al span `outbox.enqueue` de la API (por el
`traceparent` guardado), y los logs del indexer llevan `linkedTraceId`.

## Medidas de referencia (local, M-series, PostgreSQL 17 en Docker)

| Medida | Valor observado |
|---|---|
| Escritura → `indexed` con `INDEXER_POLL_MS=200` | ~0.2 s |
| 2,000 altas por la API (20 en paralelo) | 0.7 s |
| Indexar esas 2,000 (lotes de 200) | 3.6 s |
| Reconstrucción de ~1,800 publicados | ~40 ms; 1,284 búsquedas concurrentes sin error, máx. 7 ms |

En el clúster se vuelven a medir con `index_lag_seconds` y `reindex_duration_seconds` (P4-5).
