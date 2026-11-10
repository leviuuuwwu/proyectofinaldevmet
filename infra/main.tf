resource "azurerm_network_interface" "nic" {
  name                = "nic-k3s"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

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
  cloud_init_k3s = <<-EOT
    #cloud-config
    package_update: true
    packages:
      - curl
      - git
    runcmd:
      - curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="v1.30.0+k3s1" sh -s - server --secrets-encryption --disable traefik --disable servicelb --tls-san ${azurerm_public_ip.pip.fqdn}
      - mkdir -p /home/azureuser/.kube
      - cp /etc/rancher/k3s/k3s.yaml /home/azureuser/.kube/config
      - chown -R azureuser:azureuser /home/azureuser/.kube
      - sed -i 's/127.0.0.1/${azurerm_public_ip.pip.fqdn}/g' /home/azureuser/.kube/config
  EOT
}

resource "azurerm_linux_virtual_machine" "vm" {
  name                  = "vm-k3s-node"
  resource_group_name   = azurerm_resource_group.rg.name
  location              = azurerm_resource_group.rg.location
  size                  = "Standard_B2s"
  admin_username        = "azureuser"
  network_interface_ids = [azurerm_network_interface.nic.id]

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
    version   = "latest"
  }

  custom_data = base64encode(local.cloud_init_k3s)
}

output "public_ip" {
  value = azurerm_public_ip.pip.ip_address
}

output "fqdn" {
  value = azurerm_public_ip.pip.fqdn
}
