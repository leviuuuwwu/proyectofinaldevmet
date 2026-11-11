#!/usr/bin/env bash
# Instala la plataforma base del clúster con versiones de chart fijadas y los
# values versionados del repo: cert-manager + ClusterIssuer de Let's Encrypt,
# ingress-nginx y el stack de observabilidad (kube-prometheus-stack, Loki,
# Tempo, OTel Collector). Idempotente: helm upgrade --install.
#
# Requiere el túnel SSH abierto y KUBECONFIG apuntando al kubeconfig de K3s
# (docs/runbooks/costos-y-reconstruccion.md, sección 6).
set -euo pipefail

CERT_MANAGER_VERSION="v1.21.3"
INGRESS_NGINX_VERSION="4.15.1"
KUBE_PROMETHEUS_STACK_VERSION="92.14.1"
LOKI_VERSION="20.0.2"
TEMPO_VERSION="3.2.1"
OTEL_COLLECTOR_VERSION="0.178.0"

cd "$(dirname "$0")/../.."

kubectl get nodes >/dev/null

helm repo add jetstack https://charts.jetstack.io --force-update >/dev/null
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx --force-update >/dev/null
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update >/dev/null
helm repo add grafana-community https://grafana-community.github.io/helm-charts --force-update >/dev/null
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts --force-update >/dev/null
helm repo update >/dev/null

install() {
  local release="$1" chart="$2" version="$3" namespace="$4" values="$5"
  echo "==> $release ($chart $version) en $namespace"
  helm upgrade --install "$release" "$chart" --version "$version" \
    --namespace "$namespace" --create-namespace -f "$values" \
    --wait --timeout 10m
}

install cert-manager jetstack/cert-manager "$CERT_MANAGER_VERSION" cert-manager \
  observability/helm-values/cert-manager.yaml
# El webhook de cert-manager puede tardar unos segundos más que sus pods.
for _ in $(seq 1 10); do
  kubectl apply -f infra/platform/cluster-issuer.yaml && break
  sleep 6
done

# Grafana lee sus credenciales de este Secret (kube-prometheus-stack.yaml). Se
# crea una sola vez con una contraseña aleatoria que nunca se imprime ni se
# versiona; para leerla, ver el runbook.
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
if ! kubectl -n monitoring get secret grafana-admin-credentials >/dev/null 2>&1; then
  kubectl -n monitoring create secret generic grafana-admin-credentials \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$(openssl rand -base64 24)"
fi

install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  "$KUBE_PROMETHEUS_STACK_VERSION" monitoring observability/helm-values/kube-prometheus-stack.yaml
install loki grafana-community/loki "$LOKI_VERSION" monitoring observability/helm-values/loki.yaml
install tempo grafana-community/tempo "$TEMPO_VERSION" monitoring observability/helm-values/tempo.yaml
install otel-collector open-telemetry/opentelemetry-collector "$OTEL_COLLECTOR_VERSION" monitoring \
  observability/helm-values/otel-collector.yaml

# Después de kube-prometheus-stack: sus values crean un ServiceMonitor, cuyo
# CRD instala ese chart.
install ingress-nginx ingress-nginx/ingress-nginx "$INGRESS_NGINX_VERSION" ingress-nginx \
  infra/helm-values/ingress-nginx.yaml

kubectl get clusterissuer letsencrypt-prod
helm list -A
