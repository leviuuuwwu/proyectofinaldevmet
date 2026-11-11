# ADR 0007: Aprobación manual del apply de Terraform

## Estado
Aceptado

## Contexto
`terraform-apply.yml` crea y modifica la infraestructura de Azure (VM, red, presupuesto) y
empieza a generar costo. DEV-08 exige que el apply corra solo en `main` y con aprobación.

La primera versión del workflow se disparaba con cada push a `main` que tocara `infra/` y
confiaba la aprobación al environment `terraform-prod`. El repositorio es privado con GitHub
Pro (cuenta de estudiantes), y en ese plan los environments **no admiten required reviewers**
(son exclusivos de GitHub Enterprise para repos privados). El environment quedó sin reglas, y
al mergear los PR #22 y #29 el apply se disparó dos veces sin aprobación. No creó recursos
solo porque el plan falló por una llave SSH no soportada.

## Decisión
Se extiende al apply el patrón del ADR 0003 (despliegue a producción):

1. **Solo ejecución manual:** `workflow_dispatch` es el único disparador; un merge a `main`
   ya no aplica nada.
2. **Solo desde `main`:** el job tiene `if: github.ref == 'refs/heads/main'`.
3. **Solo aprobadores:** el primer paso valida que `github.actor` esté en
   `vars.PROD_APPROVERS`; si no, el job aborta antes de autenticarse en Azure.
4. **Plan revisado antes:** el plan de cada cambio se publica como comentario en el PR
   (`terraform-pr.yml`) y es lo que el aprobador revisa antes de lanzar el apply. El apply
   aplica el plan que genera en la misma corrida, nunca con `-auto-approve` interactivo.

## Por qué el environment `terraform-prod` se mantiene sin reglas
El job sigue declarando `environment: terraform-prod` aunque el environment no proteja nada:
cuando un job declara un environment, GitHub emite el token OIDC con el subject
`repo:<owner>@<id>/<repo>@<id>:environment:terraform-prod`, y ese es el subject que acepta
el federated credential de `infra/bootstrap/oidc.tf`. Quitarlo rompe la autenticación con
Azure. Los secrets y variables viven a nivel de repositorio; el environment no guarda
duplicados, que tendrían prioridad y ocultarían los valores correctos.

## Limitaciones
- Cualquier persona en `PROD_APPROVERS` puede lanzar el apply sola; no hay firma de una
  segunda persona en el momento de ejecutarlo. La revisión ocurre antes: el PR con el plan
  pasa por protección de rama y CODEOWNERS.
- Cambiar `PROD_APPROVERS` es una variable del repo, no un archivo versionado; editarla
  requiere permisos de administración.

## Alternativas descartadas
1. **Required reviewers en el environment:** no disponibles en el plan actual.
2. **Apply automático en cada push a `main`:** crea recursos con costo sin una decisión
   explícita; fue justamente el incidente que motivó este ADR.
3. **Hacer público el repositorio o pagar Enterprise:** descartado por las mismas razones
   que en el ADR 0003.
