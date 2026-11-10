variable "bootstrap_resource_group_name" {
  type        = string
  description = "Resource Group propio del bootstrap, solo para el storage account del estado"
  default     = "rg-tfstate-search-engine-devmet"
}

variable "location" {
  type        = string
  description = "Región de Azure (misma que infra/variables.tf). Debe estar en la lista de regiones permitidas por la política \"Allowed resource deployment regions\" de la suscripción (westus2, canadacentral, chilecentral, mexicocentral, northcentralus)."
  default     = "westus2"
}

variable "storage_account_name" {
  type        = string
  description = "Nombre global del storage account para el backend remoto de Terraform (3-24, minúsculas y números)"

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))
    error_message = "storage_account_name debe tener 3-24 caracteres, solo minúsculas y números."
  }
}

variable "container_name" {
  type        = string
  description = "Contenedor de blobs donde vivirá el *.tfstate"
  default     = "tfstate"
}

variable "target_resource_group_name" {
  type        = string
  description = "Resource Group que gestionará infra/main.tf (ver infra/variables.tf). El Service Principal queda limitado a este scope."
  default     = "rg-search-engine-devmet"
}

variable "github_org" {
  type        = string
  description = "Organización/usuario de GitHub que ejecuta los workflows"
  default     = "leviuuuwwu"
}

variable "github_repo" {
  type        = string
  description = "Repositorio de GitHub"
  default     = "proyectofinaldevmet"
}

variable "github_branch" {
  type        = string
  description = "Rama habilitada para el federated credential (OIDC)"
  default     = "main"
}

variable "app_display_name" {
  type        = string
  description = "Nombre de la App Registration usada por GitHub Actions"
  default     = "search-engine-devmet-github-actions"
}

variable "terraform_apply_environment" {
  type        = string
  description = "Nombre del Environment de GitHub que usa el job de apply (.github/workflows/terraform-apply.yml). GitHub emite el subject OIDC como repo:ORG/REPO:environment:<este valor> cuando el job especifica \"environment:\"."
  default     = "terraform-prod"
}
