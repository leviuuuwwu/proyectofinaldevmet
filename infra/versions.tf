terraform {
  required_version = ">= 1.8.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }

  # Backend remoto (DEV-07, 5.6). Partial configuration a propósito: los
  # valores (creados por infra/bootstrap, ver ADR 0004) no se hardcodean aquí.
  # Se completan en `terraform init` con -backend-config, por ejemplo:
  #   terraform init \
  #     -backend-config="resource_group_name=$TF_BACKEND_RESOURCE_GROUP_NAME" \
  #     -backend-config="storage_account_name=$TF_BACKEND_STORAGE_ACCOUNT_NAME" \
  #     -backend-config="container_name=$TF_BACKEND_CONTAINER_NAME" \
  #     -backend-config="key=terraform.tfstate"
  # o con un archivo *.backendconfig (no versionado) pasado como
  # -backend-config=<archivo>. Las credenciales de Azure las toma el provider
  # (OIDC de infra/bootstrap en CI, `az login` local para uso manual).
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
}
