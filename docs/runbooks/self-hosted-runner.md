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
2. **Confirmar que es la VM del proyecto antes de registrar.** El hostname no basta (otra
   VM creada con el mismo Terraform también se llama `vm-k3s-node`): la IP pública debe
   coincidir con `terraform output public_ip` (`20.109.191.166` al escribir esto).
   ```sh
   curl -s https://ifconfig.me
   ```
3. Leví genera el token de registro **en ese momento** (vence en 1 hora) y lo pasa por
   privado, nunca en el repo ni en un PR:
   `gh api -X POST repos/leviuuuwwu/proyectofinaldevmet/actions/runners/registration-token --jq .token`
4. Registrar con las labels que usan los workflows:
   ```sh
   ./config.sh --url https://github.com/leviuuuwwu/proyectofinaldevmet --token <TOKEN> \
     --name vm-k3s-node --labels k3s-cluster --unattended
   ```
5. **Definir `KUBECONFIG` para los jobs.** El `kubectl` de K3s ignora `~/.kube/config` y usa
   `/etc/rancher/k3s/k3s.yaml` (que `gh-runner` no puede leer) si `KUBECONFIG` no está
   definido. El runner carga `actions-runner/.env` en cada job:
   ```sh
   echo "KUBECONFIG=/home/gh-runner/.kube/config" >> /home/gh-runner/actions-runner/.env
   ```
6. Instalar como servicio que corre como `gh-runner` (no root):
   `sudo ./svc.sh install gh-runner && sudo ./svc.sh start`
7. Comprobar en GitHub (Settings → Actions → Runners) que `vm-k3s-node` aparece `Idle` con
   las labels `self-hosted, linux, x64, k3s-cluster`, y que es **el único** runner registrado.

`kubectl` ya viene con K3s; los workflows usan el kustomize integrado (`kubectl apply -k`).
El paso "Diagnose on failure" de los workflows imprime pods, eventos y logs si un despliegue
falla (`deploy/scripts/diagnose.sh`); sirve también a mano.

## 3. Secrets de los environments

`development` y `production` necesitan `PG_PASSWORD` y `AUTH_TOKENS_JSON` (valores
distintos por ambiente; contraseña con `openssl rand -base64 24`). `production` además
necesita `KUBE_PROD_TOKEN` (paso 1). El secret `KUBECONFIG` ya no se usa.

`DATABASE_URL` lo arma el workflow con la contraseña codificada para URL
(`deploy/scripts/database-url.sh`): las contraseñas base64 traen `/ + =`.

**Cambiar `PG_PASSWORD` no cambia la contraseña de una base ya creada.** La imagen de
PostgreSQL solo usa `POSTGRES_PASSWORD` al inicializar el volumen. Si se rota con datos que
hay que conservar, primero se cambia dentro de la base
(`ALTER USER search PASSWORD '…'` vía `kubectl exec` en `postgres-0`) y luego el secret; si
los datos de ese ambiente se pueden regenerar (dev), se borra el StatefulSet y su PVC
(`data-postgres-0`) y el siguiente despliegue la crea con el valor nuevo.

## Rotación y baja

- **Tokens de las ServiceAccounts** (si alguien sale del equipo o se sospecha fuga):
  `sudo k3s kubectl -n ci-system delete secret ci-deployer-dev-token ci-deployer-prod-token`,
  volver a aplicar `deploy/cluster/ci-deployer.yaml`, regenerar el kubeconfig del runner y
  volver a cargar `KUBE_PROD_TOKEN` (paso 1).
- **Quitar el runner:** `sudo ./svc.sh stop && sudo ./svc.sh uninstall` y
  `./config.sh remove --token <token de remoción>` (Settings → Actions → Runners).
- **VM apagada** (`infra/scripts/vm-stop.sh`): los despliegues quedan en cola hasta que el
  runner vuelva; al encenderla, el servicio arranca solo.
