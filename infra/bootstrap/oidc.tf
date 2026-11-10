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

# Subject de un push directo a la rama (sin environment en el job). Ningún
# workflow actual lo usa tal cual, pero se deja por si se agrega uno así.
resource "azuread_application_federated_identity_credential" "github_actions" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-actions-${var.github_branch}"
  description    = "OIDC: ${var.github_org}/${var.github_repo}@${var.github_branch}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_branch}"
}

# Subject real que emite GitHub para el evento pull_request (terraform-pr.yml,
# job sin "environment:"). No es el mismo formato que el de push a rama.
resource "azuread_application_federated_identity_credential" "github_actions_pull_request" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-actions-pull-request"
  description    = "OIDC: ${var.github_org}/${var.github_repo} pull_request (terraform-pr.yml)"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}/${var.github_repo}:pull_request"
}

# Subject real que emite GitHub cuando el job especifica "environment:"
# (terraform-apply.yml usa environment: terraform-prod) — GitHub cambia el
# subject a esta forma en vez de usar el ref de la rama.
resource "azuread_application_federated_identity_credential" "github_actions_environment" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-actions-environment-${var.terraform_apply_environment}"
  description    = "OIDC: ${var.github_org}/${var.github_repo} environment:${var.terraform_apply_environment} (terraform-apply.yml)"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}/${var.github_repo}:environment:${var.terraform_apply_environment}"
}

# Contributor limitado al Resource Group del stack principal, no a la suscripción.
resource "azurerm_role_assignment" "github_actions_contributor" {
  scope                = azurerm_resource_group.target.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id
}
