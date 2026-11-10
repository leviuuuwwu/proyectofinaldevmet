# infra — Terraform, K3s y base del clúster

Dueños: Daniela y Ricardo. Bootstrap documentado (backend remoto con lease, identidad OIDC), recursos
Azure en Terraform (VM, red, NSG con 6443 cerrado), K3s por cloud-init con `--secrets-encryption`
y presupuesto/alertas de costo. Namespaces `search-dev` y `search-prod` (`docs/contracts/runtime.md`).

Requisitos: DEV-06, DEV-07, DEV-08, DEV-09, DEV-13, DEV-14; condiciones 5.3, 5.6 y 5.9.

Prueba aislada: `terraform fmt -check && terraform validate`; `terraform plan` solo con
credenciales locales. El estado (`*.tfstate`) y los `*.tfvars` reales nunca van al repo.

Costos, detener/arrancar/destruir (`scripts/`), reconstrucción y acceso por túnel SSH:
`docs/runbooks/costos-y-reconstruccion.md`.
