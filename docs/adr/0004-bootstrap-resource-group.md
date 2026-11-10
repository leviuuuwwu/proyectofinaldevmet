# ADR 0004: Bootstrap gestiona el resource group; main usa data source

## Estado
Aceptado

## Contexto
El Service Principal de OIDC creado en `infra/bootstrap/oidc.tf` tiene el rol
`Contributor` limitado al scope del Resource Group del stack principal
(`target_resource_group_name`), no a la suscripción completa. Para poder
asignar ese rol, el Resource Group debe existir antes de que el stack
principal (`infra/`) corra con esa identidad: por eso `infra/bootstrap/storage.tf`
ya lo crea como parte del bootstrap. Si `infra/main.tf` sigue declarando ese
mismo Resource Group como recurso administrado (`azurerm_resource_group.rg`),
el primer `terraform apply` del stack principal con la identidad OIDC falla
porque el recurso ya existe y el SP no tiene permiso para gestionarlo fuera
de su propio scope.

## Decisión
`infra/bootstrap` crea y es dueño del ciclo de vida del Resource Group.
`infra/main.tf` deja de declararlo como `resource` y lo consume como
`data "azurerm_resource_group" "rg"`, referenciando únicamente su nombre
(`var.resource_group_name`). Todas las referencias internas a
`azurerm_resource_group.rg` pasan a `data.azurerm_resource_group.rg`.

## Alternativa descartada
Dar al Service Principal el rol `Contributor` a nivel de suscripción
completa, lo que le permitiría crear su propio Resource Group igual que
cualquier otro recurso. Descartada por violar mínimo privilegio (COM-06):
expondría el resto de la suscripción (otros resource groups, si los hubiera)
a la misma identidad usada solo para este proyecto.

## Consecuencias
- El bootstrap (`infra/bootstrap/`) es un prerrequisito documentado y
  obligatorio del primer `terraform apply` del stack principal; el
  `README.md` de `infra/bootstrap/` ya lo indica.
- Si el Resource Group necesita recrearse, debe hacerse desde
  `infra/bootstrap`, no desde `infra/`.
- `infra/main.tf` no puede borrar el Resource Group vía `terraform destroy`
  del stack principal; solo el bootstrap puede.
