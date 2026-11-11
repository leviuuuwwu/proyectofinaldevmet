# Ingress Controller Setup (ingress-nginx)

Instalacion de ingress-nginx en el cluster K3s para resolver trafico perimetral y validacion ACME HTTP-01 con cert-manager.

### Comando de Instalacion / Upgrade

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --version 4.15.1 \
  --namespace ingress-nginx \
  --create-namespace \
  -f infra/helm-values/ingress-nginx.yaml
```

Instalar después de kube-prometheus-stack: estos values crean un `ServiceMonitor`, cuyo CRD
instala ese chart. `infra/scripts/platform-install.sh` instala toda la plataforma en ese orden.
