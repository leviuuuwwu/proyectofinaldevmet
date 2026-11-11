#!/usr/bin/env bash
# Diagnóstico de solo lectura de un namespace de la app: estado, eventos y logs.
# Lo usan los workflows de despliegue cuando fallan; también sirve a mano.
# Uso: deploy/scripts/diagnose.sh search-dev
# Nunca imprime Secrets (solo nombres); los logs de la app no contienen tokens.
set -uo pipefail
NS="${1:?namespace}"

section() { printf '\n===== %s =====\n' "$1"; }

section "Pods"
kubectl -n "$NS" get pods -o wide

section "Workloads"
kubectl -n "$NS" get deploy,statefulset,job -o wide

section "Job db-migration"
kubectl -n "$NS" describe job db-migration 2>/dev/null | sed -n '/^Pods Statuses:/,$p'

for pod in $(kubectl -n "$NS" get pods -o name); do
	phase=$(kubectl -n "$NS" get "$pod" -o jsonpath='{.status.phase}')
	ready=$(kubectl -n "$NS" get "$pod" -o jsonpath='{.status.containerStatuses[*].ready}')
	# Solo los Pods con problemas: no Running/Succeeded, o algún contenedor no listo.
	if [[ "$phase" == "Succeeded" ]] || { [[ "$phase" == "Running" ]] && [[ "$ready" != *false* ]]; }; then
		continue
	fi
	section "$pod ($phase, ready=$ready)"
	kubectl -n "$NS" describe "$pod" | sed -n '/^Containers:/,/^Conditions:/p' | grep -E 'State:|Reason:|Exit Code:|Restart Count:|Last State:' || true
	kubectl -n "$NS" describe "$pod" | sed -n '/^Events:/,$p' | tail -15
	echo "--- logs (últimas 40 líneas)"
	kubectl -n "$NS" logs "$pod" --all-containers --tail=40 2>&1 || true
	echo "--- logs del contenedor anterior"
	kubectl -n "$NS" logs "$pod" --all-containers --previous --tail=20 2>&1 || true
done

section "Eventos recientes"
kubectl -n "$NS" get events --sort-by=.lastTimestamp 2>/dev/null | tail -25
exit 0
