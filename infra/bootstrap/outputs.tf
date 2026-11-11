output "storage_account_name" {
  value = azurerm_storage_account.tfstate.name
}

output "container_name" {
  value = azurerm_storage_container.tfstate.name
}

output "client_id" {
  description = "Application (client) ID a usar en AZURE_CLIENT_ID (GitHub Actions OIDC)"
  value       = azuread_application.github_actions.client_id
}

output "plan_client_id" {
  description = "Client ID de la identidad de solo lectura para el plan de los PR (secret ARM_CLIENT_ID_PLAN)"
  value       = azuread_application.github_actions_plan.client_id
}

output "tenant_id" {
  description = "Tenant ID a usar en AZURE_TENANT_ID (GitHub Actions OIDC)"
  value       = data.azurerm_client_config.current.tenant_id
}
