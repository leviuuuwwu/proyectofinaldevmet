# Índice de evidencia

Un mapa de cada criterio de las rúbricas (Anexos I y II) a su evidencia: qué archivo la contiene,
cómo se genera y quién la produce. Las salidas se guardan **como texto** en esta carpeta
(`… | tee docs/evidencia/<area>/<archivo>`); las capturas de pantalla complementan, no reemplazan
(condición 5.8).

**Antes de guardar cualquier salida:** nunca incluir tokens, contraseñas, kubeconfigs ni el
contenido de Secrets (5.3). `kubectl get secret` solo con `-o name`; los tokens de prueba
viajan en variables de entorno, no en la línea de comandos que se guarda.

Variables usadas abajo:

```sh
export HOST=search-engine-devmet.westus2.cloudapp.azure.com     # prod (HTTPS)
export DEV=http://localhost:8080                                 # dev por port-forward:
# kubectl -n search-dev port-forward svc/search-api 8080:8080    (con el túnel SSH abierto)
mkdir -p docs/evidencia/{app,ci,infra,k8s,entrega,costos,metricas,met07}
```

Estado: ✅ ya está en el repo · ⏳ hay que ejecutarlo en el clúster y guardar la salida.

## Anexo I — DevOps

### Funcionalidad y arquitectura (15) · responsables: Leví, Astrid

| Evidencia | Estado | Dónde / cómo |
|---|---|---|
| Diagrama real y decisiones | ✅ | `docs/arquitectura.md`, `docs/adr/0001`–`0007`, `docs/semantica-indexacion.md` |
| Contrato de la API | ✅ | `docs/contracts/openapi.yaml` |
| Datos ficticios deterministas (ESC4-10, P4-1) | ⏳ | `BASE_URL=$DEV EDITOR_TOKEN=… npm run -s start -w tools/datagen \| tee docs/evidencia/app/datagen.json` |
| Pruebas de aceptación (COM-01/04/05) | ⏳ | `BASE_URL=$DEV npm run test:acceptance 2>&1 \| tee docs/evidencia/app/aceptacion.txt` |
| Resultados esperados de búsqueda (P4-1, P4-4) | ⏳ | `BASE_URL=$DEV npm run test:golden 2>&1 \| tee docs/evidencia/app/golden.txt` |
| Carga (5.8, P4-2, P4-5) | ⏳ | `BASE_URL=$DEV npm run test:load 2>&1 \| tee docs/evidencia/app/carga.txt` |
| Falla controlada (5.8) | ⏳ | `docs/experimento-met07.md` (ver MET-07) |

### Contenedores e integración continua (15) · responsable: Ricardo

| Evidencia | Estado | Dónde / cómo |
|---|---|---|
| Dockerfile multi-stage, no root, base por digest | ✅ | `Dockerfile` |
| Escaneo de la imagen (Trivy, `exit-code 1`) | ✅ | `.github/workflows/app-delivery.yml`; enlace a una corrida verde en `docs/evidencia/ci/README.md` |
| Pruebas y validaciones en PR | ✅ | `.github/workflows/ci.yml`, `terraform-pr.yml`; enlazar un PR con los checks |
| Protección de rama que bloquea | ⏳ | `gh api repos/leviuuuwwu/proyectofinaldevmet/branches/main/protection \| tee docs/evidencia/ci/proteccion-main.json` + un PR bloqueado por un check en rojo (captura) |
| Trazabilidad commit → imagen | ⏳ | `gh run list --workflow app-delivery.yml --branch main --limit 5 \| tee docs/evidencia/ci/builds.txt` y la página del paquete en GHCR (etiquetas OCI `revision`, `created`) |

### Infraestructura con Terraform (20) · responsable: Daniela

| Evidencia | Estado | Dónde / cómo |
|---|---|---|
| Recursos versionados, backend remoto, bootstrap | ✅ | `infra/`, `infra/bootstrap/`, ADR 0004 |
| Verificación de la plataforma | ✅ | `docs/runbooks/costos-y-reconstruccion.md` §7 |
| Plan revisable en un PR | ⏳ | Enlace a un PR con el comentario del `terraform plan` |
| Apply controlado | ✅ | `terraform-apply.yml` (manual + `PROD_APPROVERS`), ADR 0007; enlace a la corrida |
| K3s automatizado y nodo Ready | ⏳ | `kubectl get nodes -o wide \| tee docs/evidencia/infra/nodos.txt` |

### Kubernetes y operación (20) · responsable: Ricardo

| Evidencia | Estado | Dónde / cómo |
|---|---|---|
| Workloads desde imágenes trazables | ⏳ | `kubectl -n search-dev get deploy,sts,job -o wide \| tee docs/evidencia/k8s/workloads-dev.txt` |
| Configuración y secretos fuera de la imagen | ✅/⏳ | Overlays (`configMapGenerator`), `deploy.yml` (Secrets desde environments); `kubectl -n search-dev get configmap,secret -o name \| tee docs/evidencia/k8s/config.txt` |
| Qué protege el Secret (4.2) | ✅ | K3s con `--secrets-encryption` (runbook de infra §7); RBAC: el runner no lee Secrets fuera de su namespace |
| Red: Services, Ingress con TLS, puertos | ⏳ | `kubectl -n search-prod get svc,ingress \| tee docs/evidencia/k8s/red.txt`; `curl -sv https://$HOST/healthz 2>&1 \| grep -E 'subject\|issuer\|HTTP/' \| tee docs/evidencia/k8s/tls.txt`; NSG en el runbook de infra |
| NetworkPolicies (mínimo privilegio de red) | ✅ | `deploy/base/network-policy.yaml` (default-deny) |
| Persistencia ante reinicio (COM-03) | ⏳ | Crear documento → `kubectl -n search-dev delete pod postgres-0` → `GET /documents/{id}` sigue: guardar la secuencia en `docs/evidencia/k8s/persistencia.txt` |
| Probes y su efecto | ✅/⏳ | Manifiestos de `deploy/base`; demo: detener PostgreSQL → api `0/1 Ready` (`kubectl get pods`, `get endpoints`) sin reinicios |
| Requests y límites justificados con consumo | ⏳ | Con carga: `kubectl top pods -n search-dev \| tee docs/evidencia/k8s/top.txt` y las consultas P4 de `docs/metricas.md`; anotar la justificación en `docs/evidencia/k8s/recursos.md` |
| Diagnóstico | ✅ | `docs/runbooks/rollback-and-diagnosis.md` §3 |

### Entrega continua y recuperación (20) · responsables: Ricardo, Leví

| Evidencia | Estado | Dónde / cómo |
|---|---|---|
| Promoción controlada dev → prod | ✅/⏳ | `deploy.yml` (automático), `deploy-prod.yml` (manual + aprobadores), ADR 0003; enlaces a las corridas |
| Versión identificable por ambiente | ⏳ | `curl -fsS $DEV/version; curl -fsS https://$HOST/version \| tee docs/evidencia/entrega/versiones.txt` |
| Rollback demostrado y verificado | ⏳ | Runbook §2.1 (pipeline) y §2.5 (demo): guardar comandos y salidas en `docs/evidencia/entrega/rollback.txt` |
| Tratamiento de cambios de datos | ✅ | Migraciones expand/contract (`apps/api/migrations`), runbook §2.3 |

### Reproducibilidad, seguridad y costos (10) · responsable: Daniela

| Evidencia | Estado | Dónde / cómo |
|---|---|---|
| Reconstrucción documentada | ✅ | `docs/runbooks/costos-y-reconstruccion.md` §5, `docs/runbooks/self-hosted-runner.md` |
| Mínimo privilegio (Azure, K8s, pipelines) | ✅/⏳ | OIDC lectura/escritura separados (#48), `deploy/cluster/ci-deployer.yaml`; `kubectl auth can-i` del runbook del runner → `docs/evidencia/infra/can-i.txt` |
| Sin secretos expuestos | ✅ | `.gitignore`, GitGuardian en cada PR, secrets en environments |
| Costos: estimación, cargos observados, alertas, apagado | ✅/⏳ | Runbook de costos §1–4, `infra/budget.tf`; **cargos observados**: export o captura de Cost Management en `docs/evidencia/costos/` |

## Anexo II — Métricas de Software · responsables: Astrid, Leví

| Criterio | Estado | Dónde / cómo |
|---|---|---|
| Preguntas, SLIs, SLOs, presupuesto (20) | ✅/⏳ | `docs/metricas.md` §1–4; ⏳ valores reales del SLI en la ventana de prueba (consultas §3) → `docs/evidencia/metricas/sli.txt` |
| Logging y correlación (15) | ⏳ | Consulta en Loki que sigue un `correlationId` y un `linkedTraceId` (metricas §6) → captura y texto en `docs/evidencia/metricas/logs.md` |
| Métricas e interpretación (20) | ⏳ | Consultas PromQL de metricas §6 con su resultado e interpretación → `docs/evidencia/metricas/promql.md` |
| Trazas con OpenTelemetry (15) | ⏳ | Una traza `catalog.write` y su `indexer.process` enlazado en Tempo, con los tiempos explicados → `docs/evidencia/metricas/trazas.md` |
| Dashboards y alertas (15) | ✅/⏳ | `observability/dashboards/*.json`, `observability/rules/` (`npm run test:rules`); ⏳ alerta disparada y resuelta (capturas con hora) |
| Investigación de incidente (15) | ⏳ | `docs/experimento-met07.md` completado con los JSON de `docs/evidencia/met07/` |

## Entregables generales

- [ ] Servicio corriendo en Azure el día de la defensa (o levantable con `infra/scripts/vm-start.sh`).
- [ ] Slides: arquitectura, decisiones (ADRs), pipeline, Terraform, Kubernetes, observabilidad,
      incidente, costos.
- [ ] Cada integrante puede explicar **todo** el sistema sin IA (la defensa individual vale la mitad).
