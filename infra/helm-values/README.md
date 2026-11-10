# Ingress Controller Setup (ingress-nginx)

Instalacion de ingress-nginx en el cluster K3s para resolver trafico perimetral y validacion ACME HTTP-01 con cert-manager.

### Comando de Instalacion / Upgrade

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  -f infra/helm-values/ingress-nginx.yaml
```
