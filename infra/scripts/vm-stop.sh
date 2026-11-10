#!/usr/bin/env bash
# Detiene la VM liberando el cómputo (deallocate): deja de cobrarse la VM,
# pero el disco y la IP pública estática se siguen cobrando (DEV-14, 5.9).
# Requiere `az login` con permisos sobre el Resource Group.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-search-devmet}"
VM_NAME="${VM_NAME:-vm-k3s-node}"

az vm deallocate --resource-group "$RESOURCE_GROUP" --name "$VM_NAME"
az vm get-instance-view --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
  --query "instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus" -o tsv
