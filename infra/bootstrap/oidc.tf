# Identidad OIDC para GitHub Actions (DEV-07, 5.6): sin secretos de larga
# duración en el repo ni en GitHub — el workflow intercambia un token OIDC de
# GitHub por un token de Azure AD en cada ejecución.

data "azurerm_client_config" "current" {}

resource "azuread_application" "github_actions" {
  display_name = var.app_display_name
}

resource "azuread_service_principal" "github_actions" {
  client_id = azuread_application.github_actions.client_id
}

resource "azuread_application_federated_identity_credential" "github_actions" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-actions-${var.github_branch}"
  description    = "OIDC: ${var.github_org}/${var.github_repo}@${var.github_branch}"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_branch}"
}

# Contributor limitado al Resource Group del stack principal, no a la suscripción.
resource "azurerm_role_assignment" "github_actions_contributor" {
  scope                = azurerm_resource_group.target.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_actions.object_id
}
