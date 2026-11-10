variable "resource_group_name" {
  type        = string
  description = "Nombre del Resource Group para el proyecto"
  default     = "rg-search-engine-devmet"
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

variable "ubuntu_image_version" {
  type        = string
  description = <<-EOT
    Versión fija (NUNCA "latest") de la imagen Canonical:ubuntu-24_04-lts:server.
    Actualizarla antes de aplicar consultando la más reciente con:
      az vm image list --publisher Canonical --offer ubuntu-24_04-lts --sku server --all \
        --query "[-1].version" -o tsv
  EOT
  default     = "24.04.202611050"

  validation {
    condition     = var.ubuntu_image_version != "latest"
    error_message = "ubuntu_image_version debe ser una versión fija (ej. 24.04.202410080), nunca \"latest\"."
  }
}

variable "k3s_install_script_sha256" {
  type        = string
  description = <<-EOT
    SHA256 de install.sh para local.k3s_version (infra/main.tf), calculado UNA
    VEZ por el administrador antes de aplicar:
      curl -fsSL https://raw.githubusercontent.com/k3s-io/k3s/<k3s_version>/install.sh | sha256sum
    Si se cambia k3s_version, este valor debe recalcularse.
  EOT
}
