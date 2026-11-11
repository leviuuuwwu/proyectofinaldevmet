# Identidad OIDC para GitHub Actions (DEV-07, 5.6): sin secretos de larga
# duración en el repo ni en GitHub — el workflow intercambia un token OIDC de
# GitHub por un token de Azure AD en cada ejecución.

data "azurerm_client_config" "current" {}

# El provider azuread v2.x ya no asigna owner por defecto (a diferencia de
# v1.x): sin esto, la app queda sin owner y la creación posterior del
# Service Principal falla con 403 "Request principal is not the owner".
data "azuread_client_config" "current" {}

resource "azuread_application" "github_actions" {
  display_name = var.app_display_name
  owners       = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "github_actions" {
  client_id = azuread_application.github_actions.client_id
}

# Este repo/org tiene activado el formato de subject de GitHub con IDs
# inmutables de owner/repo incluidos (owner@id/repo@id), en vez del formato
# simple owner/repo. Verificado contra la API real:
#   gh api repos/<org>/<repo> --jq '{repo_id: .id, owner_id: .owner.id}'
locals {
  github_repo_subject_prefix = "repo:${var.github_org}@${var.github_org_id}/${var.github_repo}@${var.github_repo_id}"
}

# La identidad con escritura confía SOLO en el environment del apply. Cualquier
# PR puede editar un workflow, así que el subject pull_request va a una
# identidad aparte de solo lectura (github_actions_plan, abajo).
#
# Subject real que emite GitHub cuando el job especifica "environment:"
# (terraform-apply.yml usa environment: terraform-prod) — GitHub cambia el
# subject a esta forma en vez de usar el ref de la rama.
resource "azuread_application_federated_identity_credential" "github_actions_environment" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-actions-environment-${var.terraform_apply_environment}"
  description    = "OIDC: ${var.github_org}/${var.github_repo} environment:${var.terraform_apply_environment} (terraform-apply.yml)"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "${local.github_repo_subject_prefix}:environment:${var.terraform_apply_environment}"
}

# Contributor limitado al Resource Group del stack principal, no a la suscripción.
resource "azurerm_role_assignment" "github_actions_contributor" {
  scope                = azurerm_resource_group.target.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id
}

# Acceso al backend remoto del estado (DEV-07): el SP necesita leer/escribir
# el blob del *.tfstate, pero no el storage account completo ni el RG del
# bootstrap. Se usa use_azuread_auth = true en el backend (ver versions.tf de
# infra/) en vez de storage account keys, así que esto basta sin credenciales
# estáticas de ningún tipo.
resource "azurerm_role_assignment" "github_actions_storage_blob_data_contributor" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id
}

# Identidad de solo lectura para el plan de los PR (terraform-pr.yml). Un PR
# que modifique el workflow obtiene como mucho estos permisos: leer los
# recursos y el estado, nunca escribir. Sin permiso de escritura no puede tomar
# el lease del estado, por eso el plan corre con -lock=false.
resource "azuread_application" "github_actions_plan" {
  display_name = "${var.app_display_name}-plan"
  owners       = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "github_actions_plan" {
  client_id = azuread_application.github_actions_plan.client_id
}

# Subject real que emite GitHub para el evento pull_request (job sin
# "environment:").
resource "azuread_application_federated_identity_credential" "github_actions_plan_pull_request" {
  application_id = azuread_application.github_actions_plan.id
  display_name   = "github-actions-pull-request"
  description    = "OIDC: ${var.github_org}/${var.github_repo} pull_request (terraform-pr.yml)"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "${local.github_repo_subject_prefix}:pull_request"
}

resource "azurerm_role_assignment" "github_actions_plan_reader" {
  scope                = azurerm_resource_group.target.id
  role_definition_name = "Reader"
  principal_id         = azuread_service_principal.github_actions_plan.object_id
}

resource "azurerm_role_assignment" "github_actions_plan_storage_blob_data_reader" {
  scope                = azurerm_storage_account.tfstate.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azuread_service_principal.github_actions_plan.object_id
}
