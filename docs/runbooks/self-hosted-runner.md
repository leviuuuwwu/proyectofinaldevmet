# Runbook — runner self-hosted en la VM de K3s

Decisión en `docs/adr/0006-pipeline-connectivity-self-hosted-runner.md`. Es la única
intervención manual del despliegue (condición 5.6): se hace una vez por VM.

Requisitos: VM creada (`terraform-apply`), acceso SSH desde la IP de `TF_VAR_ADMIN_IP`,
un administrador del repo (Leví) disponible para el token. El repo es privado: no se clona en
la VM; el único archivo necesario se copia con `scp` (paso 1).

## 1. Usuario y permisos de Kubernetes

```sh
# Usuario sin sudo, solo para el runner
sudo useradd --create-home --shell /bin/bash gh-runner

# Namespaces, ServiceAccounts ci-deployer-dev / ci-deployer-prod y su RBAC (uno por ambiente)
# (desde la laptop) scp deploy/cluster/ci-deployer.yaml azureuser@search-engine-devmet.westus2.cloudapp.azure.com:/tmp/
sudo k3s kubectl apply -f /tmp/ci-deployer.yaml

# kubeconfig PERMANENTE del runner: solo la identidad de search-dev (no el admin de k3s.yaml)
TOKEN=$(sudo k3s kubectl -n ci-system get secret ci-deployer-dev-token -o jsonpath='{.data.token}' | base64 -d)
CA=$(sudo k3s kubectl -n ci-system get secret ci-deployer-dev-token -o jsonpath='{.data.ca\.crt}')
sudo -u gh-runner mkdir -p /home/gh-runner/.kube
sudo -u gh-runner tee /home/gh-runner/.kube/config >/dev/null <<EOF
apiVersion: v1
kind: Config
clusters:
- name: k3s
  cluster: { server: https://127.0.0.1:6443, certificate-authority-data: $CA }
users:
- name: ci-deployer-dev
  user: { token: $TOKEN }
contexts:
- name: dev
  context: { cluster: k3s, user: ci-deployer-dev, namespace: search-dev }
current-context: dev
EOF
sudo chmod 600 /home/gh-runner/.kube/config
unset TOKEN CA
```

El token de **producción no se guarda en la VM fuera del job**: va como secret
`KUBE_PROD_TOKEN` del environment `production` (que solo admite `main`). Desde la laptop
de un administrador del repo, sin que el token se muestre en pantalla:

```sh
ssh azureuser@search-engine-devmet.westus2.cloudapp.azure.com "sudo k3s kubectl -n ci-system get secret ci-deployer-prod-token -o jsonpath='{.data.token}' | base64 -d" \
  | gh secret set KUBE_PROD_TOKEN --env production --repo leviuuuwwu/proyectofinaldevmet
```

Verificación de mínimo privilegio (evidencia para 4.1 / DEV-10): la primera debe responder
`yes` y el resto `no`. La segunda demuestra que el runner, por sí solo, no puede tocar
producción.

```sh
sudo -u gh-runner kubectl auth can-i create deployments -n search-dev
sudo -u gh-runner kubectl auth can-i create deployments -n search-prod
sudo -u gh-runner kubectl auth can-i create deployments -n kube-system
sudo -u gh-runner kubectl auth can-i get nodes
sudo -u gh-runner kubectl auth can-i get secrets -n monitoring
```

## 2. Instalar el runner

1. Como `gh-runner`, descargar `actions-runner-linux-x64-<versión>.tar.gz` del release
   oficial de `actions/runner` con **al menos 14 días** de publicado, y verificar su
   `sha256` contra el publicado en las notas del release **antes** de descomprimir.
2. Leví genera el token de registro **en ese momento** (vence en 1 hora) y lo pasa por
   privado, nunca en el repo ni en un PR:
   `gh api -X POST repos/leviuuuwwu/proyectofinaldevmet/actions/runners/registration-token --jq .token`
3. Registrar con las labels que usan los workflows:
   ```sh
   ./config.sh --url https://github.com/leviuuuwwu/proyectofinaldevmet --token <TOKEN> \
     --name vm-k3s-node --labels k3s-cluster --unattended
   ```
4. Instalar como servicio que corre como `gh-runner` (no root):
   `sudo ./svc.sh install gh-runner && sudo ./svc.sh start`
5. Comprobar en GitHub (Settings → Actions → Runners) que `vm-k3s-node` aparece `Idle` con
   las labels `self-hosted, linux, x64, k3s-cluster`.

`kubectl` ya viene con K3s; los workflows usan el kustomize integrado (`kubectl apply -k`).

## 3. Secrets de los environments

`development` y `production` necesitan `PG_PASSWORD` y `AUTH_TOKENS_JSON` (valores
distintos por ambiente; contraseña con `openssl rand -base64 24`). `production` además
necesita `KUBE_PROD_TOKEN` (paso 1). El secret `KUBECONFIG` ya no se usa.

## Rotación y baja

- **Tokens de las ServiceAccounts** (si alguien sale del equipo o se sospecha fuga):
  `sudo k3s kubectl -n ci-system delete secret ci-deployer-dev-token ci-deployer-prod-token`,
  volver a aplicar `deploy/cluster/ci-deployer.yaml`, regenerar el kubeconfig del runner y
  volver a cargar `KUBE_PROD_TOKEN` (paso 1).
- **Quitar el runner:** `sudo ./svc.sh stop && sudo ./svc.sh uninstall` y
  `./config.sh remove --token <token de remoción>` (Settings → Actions → Runners).
- **VM apagada** (`infra/scripts/vm-stop.sh`): los despliegues quedan en cola hasta que el
  runner vuelva; al encenderla, el servicio arranca solo.
