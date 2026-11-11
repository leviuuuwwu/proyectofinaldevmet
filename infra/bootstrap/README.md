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
5. Cargar los outputs como secrets y variables **del repositorio** (no del
   environment `terraform-prod`: sus valores tendrían prioridad y ocultarían
   los del repo):
   - Secrets: `ARM_CLIENT_ID` (`client_id`), `ARM_TENANT_ID` (`tenant_id`),
     `TF_BACKEND_RESOURCE_GROUP_NAME` (variable `bootstrap_resource_group_name`),
     `TF_BACKEND_STORAGE_ACCOUNT_NAME` (`storage_account_name`),
     `TF_BACKEND_CONTAINER_NAME` (`container_name`).
   - Variable: `ARM_SUBSCRIPTION_ID` (no es output de este stack).
   Los workflows `terraform-*.yml` los pasan al backend `azurerm` de
   `infra/versions.tf` con `use_azuread_auth=true`.
6. Guardar `terraform.tfstate` (y sus backups) y `terraform.tfvars` en una
   carpeta privada fuera del repo y fuera de directorios temporales. Es la única
   excepción admitida a "nunca backend local". Para volver a operar este stack,
   copiarlos a `infra/bootstrap/` (el `.gitignore` los excluye) y correr
   `terraform init`.

## Nota sobre el scope del Service Principal

`oidc.tf` crea el Resource Group `target_resource_group_name` (mismo nombre
que `infra/variables.tf` espera, `rg-search-devmet` por defecto) y
asigna `Contributor` solo ahí — no a la suscripción. Esto implica que
`infra/main.tf` debe dejar de **crear** ese Resource Group (`azurerm_resource_group.rg`)
y pasar a referenciarlo como `data "azurerm_resource_group"`, porque ya existe
cuando el workflow de GitHub Actions corre con esta identidad. Ese cambio de
arquitectura requiere su propio ADR y no se ha hecho aquí.

## Qué no incluye este bootstrap

Sin lease management adicional: el lock de estado lo da el blob lease nativo
del backend `azurerm` de Terraform sobre el blob del `*.tfstate`; por eso el
storage account no debe tener políticas de inmutabilidad activadas.
