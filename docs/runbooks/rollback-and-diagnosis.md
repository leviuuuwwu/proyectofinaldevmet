# Runbook: versión activa, rollback y diagnóstico (DEV-12, sección 4.3)

Acceso administrativo al clúster: túnel SSH (`docs/runbooks/costos-y-reconstruccion.md` §6). En
los comandos, `NS` es `search-dev` o `search-prod` y `HOST` es
`search-engine-devmet.westus2.cloudapp.azure.com` (prod tiene Ingress con HTTPS; para dev se usa
`kubectl -n search-dev port-forward svc/search-api 8080:8080` y `HOST=localhost:8080` por HTTP local).

## 1. Qué versión corre en cada ambiente

Una imagen por commit (`ghcr.io/leviuuuwwu/search-api:<sha>`), sin `latest` en los despliegues.

```bash
curl -fsS https://$HOST/version                      # {"version":"…","commit":"<sha>","builtAt":"…"}
kubectl -n $NS get deploy -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image
```
En Prometheus: `max by (namespace, component, commit) (app_build_info)`. En GitHub, el resumen
de cada corrida de `Continuous Deployment` / `Deploy to Production` dice qué SHA se desplegó y quién.
Así se relaciona commit → workflow → imagen → Pod (DEV-04).

## 2. Rollback (DEV-12)

### 2.1 Recomendado: volver a desplegar el commit anterior por el pipeline

Trazable y repetible: queda en el historial de Actions y no se pierde en el siguiente despliegue.

```bash
# Elegir el último SHA bueno (los anteriores en main con build exitoso)
gh run list --workflow app-delivery.yml --branch main --status success --limit 5 \
  --json headSha,displayTitle --jq '.[] | "\(.headSha) \(.displayTitle)"'

gh workflow run deploy.yml      --ref main -f image_sha=<sha-bueno>   # dev
gh workflow run deploy-prod.yml --ref main -f image_sha=<sha-bueno>   # prod (solo PROD_APPROVERS)
gh run watch
```
Ambos workflows verifican que el SHA esté en `main` y tenga imagen construida antes de tocar el
clúster. Después, revertir en `main` el commit defectuoso con un PR (`git revert`), para que el
siguiente despliegue automático no lo vuelva a traer.

### 2.2 Emergencia: `kubectl rollout undo`

Más rápido, pero queda fuera del pipeline: **el siguiente despliegue automático lo pisa**. Úsese
solo para cortar el impacto y seguir con 2.1.

```bash
kubectl -n $NS rollout history deployment/search-api
kubectl -n $NS rollout undo deployment/search-api
kubectl -n $NS rollout undo deployment/search-indexer
kubectl -n $NS rollout status deployment/search-api --timeout=90s
```

### 2.3 Datos

- Las migraciones son **expand/contract**: cada una es compatible con la imagen anterior, así que
  volver a la versión previa no requiere tocar la base.
- **Un rollback no restaura datos** (4.2): lo escrito con la versión defectuosa queda en el
  catálogo. Si hubo escrituras incorrectas se corrigen por la API; si el índice quedó
  inconsistente, `POST /admin/reindex` lo reconstruye desde el catálogo.
- Si alguna vez se agrega una migración destructiva (fase *contract*), no se hace rollback más
  allá de ella sin un respaldo previo (`pg_dump`) y su procedimiento de restauración.

### 2.4 Verificación posterior

```bash
curl -fsS https://$HOST/version          # commit == <sha-bueno>
BASE_URL=https://$HOST npm run smoke      # /healthz, /readyz, /version en 200
kubectl -n $NS get pods                   # todos Ready, sin reinicios nuevos
curl -fsS -H "Authorization: Bearer $EDITOR_TOKEN" https://$HOST/index/status   # pending/failed en 0
```

### 2.5 Demostración reversible para la defensa (dev)

Simula un despliegue defectuoso sin tocar código ni datos:

```bash
kubectl -n search-dev set image deployment/search-api api=ghcr.io/leviuuuwwu/search-api:no-existe
kubectl -n search-dev get pods -w          # el Pod nuevo queda en ImagePullBackOff…
curl -fsS http://localhost:8080/version     # …y el anterior sigue atendiendo (rolling update)
kubectl -n search-dev rollout undo deployment/search-api
kubectl -n search-dev rollout status deployment/search-api
curl -fsS http://localhost:8080/version     # mismo commit que antes de la falla
```
Qué muestra: la readiness evita mandar tráfico a un Pod que no está listo, el rolling update
mantiene el Pod viejo hasta que el nuevo esté Ready, y `/version` prueba qué versión quedó activa.

## 3. Diagnóstico por síntoma (preguntas de la sección 4.3)

Primeros comandos siempre: `kubectl -n $NS get pods`, `kubectl -n $NS describe pod <pod>` (sección
*Events* y *Last State*) y `kubectl -n $NS logs <pod> [--previous]`.

| Síntoma | Evidencia | Causa probable | Acción |
|---|---|---|---|
| `ImagePullBackOff` / `ErrImagePull` | Events: `Failed to pull image … not found` | Tag inexistente o registro inaccesible | Corregir el tag/SHA (rollback 2.1) |
| `CrashLoopBackOff` al arrancar | `logs --previous`: `"event":"config.invalid"` con la lista de variables | Falta o es inválida una variable (`app-config` o `app-secrets`) | Revisar el ConfigMap del overlay y los secrets del environment |
| `OOMKilled` | `describe`: *Last State: Terminated, Reason: OOMKilled*, `Exit Code: 137` | Consumo de memoria mayor que `limits.memory` | Medir con `kubectl top pod` / `container_memory_working_set_bytes` y ajustar límites (DEV-11) |
| Pod `Running` pero `0/1 Ready`; la API no recibe tráfico | `describe`: `Readiness probe failed: HTTP 503`; `kubectl get endpoints search-api` sin IPs | `/readyz` no alcanza PostgreSQL | `kubectl -n $NS get pods -l app=postgres`, logs de `postgres-0`; la API se reincorpora sola al volver la base (no se reinicia: `/healthz` sigue en 200) |
| Reinicios por liveness | Events: `Liveness probe failed`, contador `RESTARTS` creciente | El proceso dejó de responder | Logs previos; revisar CPU throttling (`limits.cpu`) |
| Pod `Pending` | Events: `0/1 nodes are available: Insufficient memory/cpu` | Requests mayores que lo libre en el nodo | Bajar requests justificadamente o redimensionar la VM (DEV-14) |
| Job `db-migration` no termina | `kubectl -n $NS logs job/db-migration`: `migration.failed` | SQL inválido, base no alcanzable o NetworkPolicy | Corregir la migración; verificar `postgres-network-policy` |
| Búsquedas sin cambios recientes | `/index/status` con `pending` creciendo; alerta `IndexFreshnessStale` | Indexer detenido o fallando | `kubectl -n $NS get pods -l app=search-indexer`, logs `index.failed`; ver `docs/experimento-met07.md` |

## 4. Detener un Pod de forma controlada: qué se recupera y qué no

```bash
kubectl -n $NS delete pod -l app=search-api        # o search-indexer, o postgres-0
kubectl -n $NS get pods -w
```

| Pod | Se recupera | No se recupera / efecto visible |
|---|---|---|
| `search-api` | El Deployment crea otro; los datos están en PostgreSQL | Solicitudes en curso al momento del SIGTERM pueden fallar; una reconstrucción en curso queda `failed` (`interrupted`) y se relanza |
| `search-indexer` | Los eventos pendientes siguen en el outbox y se procesan al volver | Mientras no esté, las búsquedas no reflejan cambios (sube `index_backlog_oldest_age_seconds`) |
| `postgres-0` | El StatefulSet lo recrea con el mismo PVC: **los datos persisten** (COM-03) | Mientras reinicia, `/readyz` responde 503 en api e indexer y escrituras/búsquedas fallan; los procesos no se caen y se reconectan solos |
