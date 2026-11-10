#!/usr/bin/env bash
# Destruye los recursos del stack principal (infra/): VM, disco, red, IP y
# presupuesto (DEV-14, 5.9). NO toca el bootstrap (backend del estado e
# identidad OIDC) ni el Resource Group, que pertenece a infra/bootstrap
# (ADR 0004). Terraform pide confirmación escribiendo "yes"; no se usa
# -auto-approve.
#
# Variables requeridas (mismos valores que los secrets TF_BACKEND_* del repo):
#   TF_BACKEND_RESOURCE_GROUP_NAME, TF_BACKEND_STORAGE_ACCOUNT_NAME,
#   TF_BACKEND_CONTAINER_NAME
# y las TF_VAR_* sin default de infra/variables.tf (admin_ip,
# admin_ssh_public_key, k3s_install_script_sha256).
set -euo pipefail

: "${TF_BACKEND_RESOURCE_GROUP_NAME:?falta TF_BACKEND_RESOURCE_GROUP_NAME}"
: "${TF_BACKEND_STORAGE_ACCOUNT_NAME:?falta TF_BACKEND_STORAGE_ACCOUNT_NAME}"
: "${TF_BACKEND_CONTAINER_NAME:?falta TF_BACKEND_CONTAINER_NAME}"

cd "$(dirname "$0")/.."

terraform init -input=false \
  -backend-config="resource_group_name=${TF_BACKEND_RESOURCE_GROUP_NAME}" \
  -backend-config="storage_account_name=${TF_BACKEND_STORAGE_ACCOUNT_NAME}" \
  -backend-config="container_name=${TF_BACKEND_CONTAINER_NAME}" \
  -backend-config="key=terraform.tfstate"

terraform destroy
