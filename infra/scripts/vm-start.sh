#!/usr/bin/env bash
# Arranca la VM detenida con vm-stop.sh. La IP pública es estática, así que el
# FQDN y el acceso por túnel SSH no cambian.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-search-devmet}"
VM_NAME="${VM_NAME:-vm-k3s-node}"

az vm start --resource-group "$RESOURCE_GROUP" --name "$VM_NAME"
az vm get-instance-view --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
  --query "instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus" -o tsv
