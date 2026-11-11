resource "azurerm_network_interface" "nic" {
  name                = "nic-k3s"
  location            = data.azurerm_resource_group.rg.location
  resource_group_name = data.azurerm_resource_group.rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.pip.id
  }
}

resource "azurerm_network_interface_security_group_association" "nic_nsg" {
  network_interface_id      = azurerm_network_interface.nic.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}

locals {
  # Pin explícito del release de K3s (nunca "latest"). Verificar antes de
  # aplicar contra https://update.k3s.io/v1-release/channels o
  # https://github.com/k3s-io/k3s/releases.
  k3s_version = "v1.36.5+k3s1"

  cloud_init_k3s = <<-EOT
    #cloud-config
    package_update: true
    packages:
      - curl
      - git
    runcmd:
      # Binario de K3s: se descarga pinneado por tag y se verifica contra el
      # checksum SHA256 oficial publicado en el mismo release (no un
      # "curl | sh" ciego).
      - curl -fsSL -o /usr/local/bin/k3s "https://github.com/k3s-io/k3s/releases/download/${local.k3s_version}/k3s"
      - curl -fsSL -o /tmp/k3s-sha256sum-amd64.txt "https://github.com/k3s-io/k3s/releases/download/${local.k3s_version}/sha256sum-amd64.txt"
      - sh -c 'cd /usr/local/bin && grep "  k3s$" /tmp/k3s-sha256sum-amd64.txt | sha256sum -c -'
      - chmod +x /usr/local/bin/k3s
      # install.sh: mismo tag pinneado, verificado contra el SHA256 fijado en
      # var.k3s_install_script_sha256 (calculado una sola vez por el
      # administrador, ver infra/variables.tf).
      - curl -fsSL -o /tmp/k3s-install.sh "https://raw.githubusercontent.com/k3s-io/k3s/${local.k3s_version}/install.sh"
      - echo "${var.k3s_install_script_sha256}  /tmp/k3s-install.sh" | sha256sum -c -
      - chmod +x /tmp/k3s-install.sh
      - INSTALL_K3S_SKIP_DOWNLOAD=true /tmp/k3s-install.sh server --secrets-encryption --disable traefik --disable servicelb --tls-san ${azurerm_public_ip.pip.fqdn}
      - mkdir -p /home/azureuser/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/azureuser/.kube/config
      - chown -R azureuser:azureuser /home/azureuser/.kube
      - sed -i 's/127.0.0.1/${azurerm_public_ip.pip.fqdn}/g' /home/azureuser/.kube/config
  EOT
}

resource "azurerm_linux_virtual_machine" "vm" {
  name                = "vm-k3s-node"
  resource_group_name = data.azurerm_resource_group.rg.name
  location            = data.azurerm_resource_group.rg.location
  # Standard_B2s (v1) no está disponible en westus2 para esta suscripción
  # (SkuNotAvailable). B2s_v2: 2 vCPU / 8 GiB, familia Bsv2, solo restringe zonas
  # de disponibilidad (esta VM no usa zona). Con 4 GiB (B2ls_v2) la plataforma
  # más la app agotaban la memoria y el disco se saturaba de lecturas.
  size                  = "Standard_B2s_v2"
  admin_username        = "azureuser"
  network_interface_ids = [azurerm_network_interface.nic.id]
  # Azure lo activa al crear la VM; declararlo evita un cambio perpetuo en el plan.
  vm_agent_platform_updates_enabled = true

  admin_ssh_key {
    username   = "azureuser"
    public_key = var.admin_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = var.ubuntu_image_version
  }

  custom_data = base64encode(local.cloud_init_k3s)
}

output "public_ip" {
  value = azurerm_public_ip.pip.ip_address
}

output "fqdn" {
  value = azurerm_public_ip.pip.fqdn
}
