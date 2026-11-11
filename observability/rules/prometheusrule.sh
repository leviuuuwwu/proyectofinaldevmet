#!/usr/bin/env bash
# Envuelve search.rules.yaml (fuente única, probada con promtool) en un PrometheusRule.
# Uso: observability/rules/prometheusrule.sh | kubectl apply -f -
set -euo pipefail
cd "$(dirname "$0")"
cat <<'EOF'
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: search-rules
  namespace: monitoring
spec:
EOF
sed -e '/^#/d' -e 's/^/  /' search.rules.yaml
