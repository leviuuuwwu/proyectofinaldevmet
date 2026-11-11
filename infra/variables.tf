variable "resource_group_name" {
  type        = string
  description = "Nombre del Resource Group para el proyecto"
  default     = "rg-search-devmet"
}

variable "monthly_budget_amount" {
  type        = number
  description = "Presupuesto mensual del Resource Group en la moneda de facturación (USD). Ver docs/runbooks/costos-y-reconstruccion.md para la estimación."
  default     = 40
}

variable "budget_start_date" {
  type        = string
  description = "Inicio del presupuesto: primer día de un mes, formato RFC 3339 (YYYY-MM-01T00:00:00Z). Cambiarlo recrea el presupuesto."
  default     = "2026-11-01T00:00:00Z"

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-01T00:00:00Z$", var.budget_start_date))
    error_message = "budget_start_date debe ser el primer día de un mes: YYYY-MM-01T00:00:00Z."
  }
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

variable "extra_admin_ips" {
  type        = list(string)
  description = "IPs públicas adicionales con SSH (otros integrantes). Cambiarla solo actualiza la regla del NSG; no recrea la VM"
  default     = []

  validation {
    condition     = alltrue([for ip in var.extra_admin_ips : can(cidrhost("${ip}/32", 0))])
    error_message = "extra_admin_ips debe contener IPv4 sin máscara, p. ej. [\"203.0.113.10\"]."
  }
}

variable "admin_ssh_public_key" {
  type        = string
  description = "Clave pública SSH para el usuario admin de la VM"
}

variable "ubuntu_image_version" {
  type        = string
  description = <<-EOT
    Versión fija (NUNCA "latest") de la imagen Canonical:ubuntu-24_04-lts:server.
    Elegir una versión de la lista de la región y confirmar que se puede usar:
      az vm image list --publisher Canonical --offer ubuntu-24_04-lts --sku server \
        --location westus2 --all --query "[].version" -o tsv
      az vm image show --location westus2 \
        --urn Canonical:ubuntu-24_04-lts:server:<version>
    Una versión recién publicada puede aparecer en la lista y dar NotFound en
    "show" mientras termina de replicarse; en ese caso usar la anterior.
  EOT
  default     = "24.04.202610250"

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
