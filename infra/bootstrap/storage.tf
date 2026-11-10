# Backend remoto del estado de Terraform (DEV-07, 5.6).
# El bloqueo durante apply/plan lo da el blob lease nativo que usa el backend
# "azurerm" de Terraform: no es una opción separada a activar, pero requiere
# que el storage account NO tenga políticas de inmutabilidad (bloquearían el lease).

resource "azurerm_resource_group" "bootstrap" {
  name     = var.bootstrap_resource_group_name
  location = var.location
}

resource "azurerm_storage_account" "tfstate" {
  name                = var.storage_account_name
  resource_group_name = azurerm_resource_group.bootstrap.name
  location            = azurerm_resource_group.bootstrap.location

  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"
  min_tls_version          = "TLS1_2"

  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 14
    }
  }
}

resource "azurerm_storage_container" "tfstate" {
  name                  = var.container_name
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

# Resource Group que gestionará infra/main.tf a partir de este punto. Se crea
# aquí (y no en infra/main.tf) porque el Service Principal de oidc.tf necesita
# un scope existente antes de que el stack principal corra con esa identidad.
resource "azurerm_resource_group" "target" {
  name     = var.target_resource_group_name
  location = var.location
}
