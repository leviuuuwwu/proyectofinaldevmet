# Runbook: costos, operación y reconstrucción de la infraestructura

Requisitos: DEV-13, DEV-14; condición 5.9. Dueña: Daniela (`infra/`).

## 1. Estimación de costos

Precios de lista pay-as-you-go aproximados en USD (región `westus2`, Linux).
Verificar en la calculadora de precios de Azure antes de cada entrega; pueden cambiar.

| Recurso (Terraform) | Detalle | Encendida 24/7 | VM detenida (deallocate) |
|---|---|---|---|
| `azurerm_linux_virtual_machine.vm` | Standard_B2ls_v2, ≈ 0.0416 USD/h (verificar: la B2s v1 no está disponible en westus2) | ≈ 30.4 USD/mes | 0 |
| Disco del SO | StandardSSD_LRS, 30 GiB (E4) | ≈ 2.4 USD/mes | ≈ 2.4 USD/mes |
| `azurerm_public_ip.pip` | Standard, estática, ≈ 0.005 USD/h | ≈ 3.7 USD/mes | ≈ 3.7 USD/mes |
| Storage account del estado (bootstrap) | Standard_LRS, unos KB | < 0.1 USD/mes | < 0.1 USD/mes |
| Tráfico de salida | los primeros 100 GB/mes no se cobran | ≈ 0 | 0 |
| **Total** | | **≈ 36.5 USD/mes** | **≈ 6.2 USD/mes** |

Uso realista del proyecto (VM encendida 8 h × 22 días ≈ 176 h/mes): ≈ 7.3 USD de
cómputo + 6.2 USD fijos ≈ **13.5 USD/mes**. El crédito de Azure for Students es de
100 USD, así que hay que detener la VM cuando no se use (sección 3).

## 2. Presupuesto y alertas (DEV-13)

`infra/budget.tf` crea un presupuesto mensual sobre el Resource Group
`rg-search-devmet` (`var.monthly_budget_amount`, 40 USD por defecto) con alertas
por correo a quien tenga rol **Owner** en ese scope:

- 50 %, 80 % y 100 % del gasto real.
- 100 % del gasto pronosticado (avisa antes de llegar al límite).

Un presupuesto de Azure solo alerta, no detiene recursos: la acción ante una
alerta es la sección 3.

## 3. Operación diaria: detener y arrancar (DEV-14)

Requieren `az login` con permisos sobre el Resource Group.

```bash
infra/scripts/vm-stop.sh    # deallocate: deja de cobrarse el cómputo
infra/scripts/vm-start.sh   # misma IP y FQDN, el clúster K3s arranca solo
```

Ambos aceptan `RESOURCE_GROUP` y `VM_NAME` como variables de entorno.

## 4. Destruir

```bash
export TF_BACKEND_RESOURCE_GROUP_NAME=rg-bootstrap-devmet
export TF_BACKEND_STORAGE_ACCOUNT_NAME=tfstatedevmet2024
export TF_BACKEND_CONTAINER_NAME=tfstate
export TF_VAR_admin_ip=... TF_VAR_admin_ssh_public_key=... TF_VAR_k3s_install_script_sha256=...
infra/scripts/destroy.sh
```

Destruye VM, disco, red, IP y presupuesto. **No** destruye el bootstrap (estado
remoto e identidad OIDC) ni el Resource Group (ADR 0004), así que reconstruir no
requiere repetir el bootstrap. Con la VM destruida el costo queda en < 0.1 USD/mes.

## 5. Reconstrucción desde cero

1. **Bootstrap** (solo si se perdió el storage account o la identidad OIDC):
   seguir `infra/bootstrap/README.md`.
2. **Secrets y variables del repo** (Settings → Secrets and variables → Actions):
   - Secrets: `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `TF_BACKEND_RESOURCE_GROUP_NAME`,
     `TF_BACKEND_STORAGE_ACCOUNT_NAME`, `TF_BACKEND_CONTAINER_NAME`,
     `TF_VAR_ADMIN_SSH_PUBLIC_KEY`.
   - Variables: `ARM_SUBSCRIPTION_ID`, `TF_VAR_ADMIN_IP`,
     `TF_VAR_K3S_INSTALL_SCRIPT_SHA256`.
3. **Environment `terraform-prod`** (sin reglas: el subject OIDC del apply depende
   de su nombre) y la variable `PROD_APPROVERS` con los logins autorizados.
4. **Infraestructura**: revisar el plan publicado en el PR y, ya en `main`,
   ejecutar `terraform-apply.yml` (Actions → Run workflow, rama `main`). Solo
   corre si quien lo dispara está en `PROD_APPROVERS` (ADR 0003): el repo es
   privado y GitHub no permite required reviewers en sus environments.
5. **Esperar cloud-init** (instala K3s con versión fijada y `--secrets-encryption`):
   ```bash
   ssh azureuser@<fqdn> 'cloud-init status --wait && sudo k3s kubectl get nodes'
   ```
   El FQDN sale del output `fqdn` de Terraform.
6. **Acceso administrativo** por túnel SSH (sección 6).
7. **Plataforma base**: cert-manager y stack de observabilidad con los values de
   `observability/helm-values/`.
8. **Aplicación**: workflows de despliegue (`deploy.yml`, `deploy-prod.yml`) y
   verificación con `npm run smoke` contra `BASE_URL`.

## 6. Acceso administrativo por túnel SSH

El puerto 6443 (API de Kubernetes) está cerrado en el NSG; el 22 solo acepta la IP
del administrador (`var.admin_ip`). Al API se llega por túnel:

```bash
# 1. Copiar el kubeconfig de K3s (apunta a 127.0.0.1:6443) fuera del repo
ssh azureuser@<fqdn> 'sudo cat /etc/rancher/k3s/k3s.yaml' > ~/.kube/search-devmet.yaml
chmod 600 ~/.kube/search-devmet.yaml

# 2. Abrir el túnel en otra terminal
ssh -N -L 6443:127.0.0.1:6443 azureuser@<fqdn>

# 3. Usarlo
KUBECONFIG=~/.kube/search-devmet.yaml kubectl get nodes
```

Usar `/etc/rancher/k3s/k3s.yaml`, no `~/.kube/config` de la VM: cloud-init reescribe
el servidor de este último al FQDN público, que no responde en 6443 porque el NSG
lo bloquea. El kubeconfig nunca se versiona (`kubeconfig*` está en `.gitignore`, y
el de arriba vive en `~/.kube/`).

Si la IP del administrador cambia, actualizar la variable `TF_VAR_ADMIN_IP` y
volver a aplicar; mientras tanto el SSH (y por lo tanto el túnel) queda bloqueado.
