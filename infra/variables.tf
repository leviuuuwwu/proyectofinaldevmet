variable "resource_group_name" {
  type        = string
  description = "Nombre del Resource Group para el proyecto"
  default     = "rg-search-engine-devmet"
}

variable "location" {
  type        = string
  description = "Región de Azure"
  default     = "eastus"
}

variable "dns_label" {
  type        = string
  description = "Etiqueta DNS única para la IP pública de Azure"
  default     = "search-engine-devmet"
}

variable "admin_ip" {
  type        = string
  description = "IP pública del administrador para acceso SSH restringido (puerto 22)"
}

variable "admin_ssh_public_key" {
  type        = string
  description = "Clave pública SSH para el usuario admin de la VM"
}
