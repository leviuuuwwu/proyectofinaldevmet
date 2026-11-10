# deploy — Manifiestos Kubernetes e imagen

Dueño: Ricardo (también el `Dockerfile` de la raíz y los workflows de la app). `base/` define los Deployments
`api` e `indexer` (misma imagen, distinto entrypoint); `overlays/dev` y `overlays/prod`
ajustan namespace (`search-dev` / `search-prod`), réplicas y tag `ghcr.io/<owner>/search-api:<git-sha>`.

Requisitos: DEV-02, DEV-03, DEV-04, DEV-05, DEV-10, DEV-11, DEV-12; condiciones 5.4 y 5.7.

Prueba aislada: `kubectl kustomize deploy/overlays/dev` (render sin aplicar) y
`docker build --build-arg GIT_SHA=dev --build-arg BUILT_AT=now .`.
