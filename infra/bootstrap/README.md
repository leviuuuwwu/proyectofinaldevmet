# infra/bootstrap — una sola vez, antes del backend remoto

Este stack NO usa backend remoto (todavía no existe): corre con estado local
y credenciales del administrador, a mano, una sola vez. Después de esto,
`infra/` (el stack principal) puede migrar a backend `azurerm` y a la
identidad OIDC creada aquí. Referencia: DEV-07, sección 5.6.

## Pasos manuales

1. `az login` con una cuenta con permisos para crear resource groups, storage
   accounts, App Registrations y asignar roles (Owner o User Access
   Administrator + Contributor en la suscripción).
2. `cd infra/bootstrap && terraform init` (sin backend: queda en
   `terraform.tfstate` local — no se commitea, ver `.gitignore`).
3. `terraform plan -var="storage_account_name=<nombre-global-unico>"` y revisar.
4. `terraform apply` con la misma variable. Nunca `-auto-approve`.
5. Guardar los outputs:
   - `storage_account_name`, `container_name` → bloque `backend "azurerm"` del
     stack principal (`infra/`), que hoy no existe y debe agregarse con su
     propio ADR en `docs/adr/` antes de activarlo.
   - `client_id`, `tenant_id` → variables/secrets del repo de GitHub
     (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`) usados por `azure/login` con OIDC
     (`permissions: id-token: write` en el workflow).
   - El `subscription_id` de la suscripción usada (no es output de este
     stack) → `AZURE_SUBSCRIPTION_ID`.
6. Mover este `terraform.tfstate` local a un lugar seguro fuera del repo (o
   borrarlo si se acepta recrear el bootstrap manualmente si algo cambia). Es
   la única excepción admitida a "nunca backend local": no hay backend remoto
   todavía para guardarlo.

## Nota sobre el scope del Service Principal

`oidc.tf` crea el Resource Group `target_resource_group_name` (mismo nombre
que `infra/variables.tf` espera, `rg-search-engine-devmet` por defecto) y
asigna `Contributor` solo ahí — no a la suscripción. Esto implica que
`infra/main.tf` debe dejar de **crear** ese Resource Group (`azurerm_resource_group.rg`)
y pasar a referenciarlo como `data "azurerm_resource_group"`, porque ya existe
cuando el workflow de GitHub Actions corre con esta identidad. Ese cambio de
arquitectura requiere su propio ADR y no se ha hecho aquí.

## Qué no incluye este bootstrap

Sin lease management adicional: el lock de estado lo da el blob lease nativo
del backend `azurerm` de Terraform sobre el blob del `*.tfstate`; por eso el
storage account no debe tener políticas de inmutabilidad activadas.
