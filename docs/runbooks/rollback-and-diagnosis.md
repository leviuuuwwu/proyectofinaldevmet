# Runbook: Diagnóstico y Rollback de la Aplicación (DEV-12)

Este procedimiento describe cómo investigar incidentes en los componentes search-api y search-indexer, y cómo ejecutar un rollback determinista validándolo contra /version.

## 1. Diagnóstico de Salud

### Verificar estado de Pods
```bash
kubectl get pods -n search-prod -l app=search-api
kubectl get pods -n search-prod -l app=search-indexer
```

### Inspeccionar Probes (/healthz y /readyz)
Si un pod está en estado CrashLoopBackOff o falla el readiness probe:
```bash
kubectl describe pod -l app=search-api -n search-prod | grep -A 5 -E "(Liveness|Readiness)"
```

### Consultar Logs estructurados
```bash
kubectl logs -n search-prod -l app=search-api --tail=100
```

---

## 2. Procedimiento de Rollback (DEV-12)

Si una versión recién desplegada causa errores 5xx o degradación de indexación:

1. **Consultar el historial de despliegues:**
   ```bash
   kubectl rollout history deployment/search-api -n search-prod
   ```

2. **Ejecutar el rollback a la revisión inmediata anterior:**
   ```bash
   kubectl rollout undo deployment/search-api -n search-prod
   kubectl rollout undo deployment/search-indexer -n search-prod
   ```

3. **Monitorear la estabilización de los pods:**
   ```bash
   kubectl rollout status deployment/search-api -n search-prod --timeout=90s
   ```

4. **Verificar la versión restaurada:**
   Consultar el endpoint /version para comprobar que gitSha corresponde al commit previo estable:
   ```bash
   curl -fsS [https://search-api.local/version](https://search-api.local/version)
   ```
