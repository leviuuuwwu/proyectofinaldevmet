# ADR 0006: Conectividad de Pipelines CI/CD hacia K3s mediante GitHub Actions Self-Hosted Runner

- **Estado:** Aceptado (revisado 2026-11-11: identidad de mínimo privilegio y riesgo aceptado)
- **Fecha:** 2026-11-10
- **Decisores:** Ricardo Cubias, Levi Guerra, Daniela Guardado
- **Contexto de Requisitos:** Criterios 4.1, 5.3 y SEC-02

---

## 1. Contexto y Problematica

Los flujos de trabajo de entrega continua (`.github/workflows/deploy.yml` y `.github/workflows/deploy-prod.yml`) requieren ejecutar comandos administrativos (`kubectl apply`, `kubectl rollout`, `kubectl wait`) contra el API Server del cluster K3s para desplegar componentes en los namespaces `search-dev` y `search-prod`.

El puerto de control `6443` se encuentra bloqueado deliberadamente en el Network Security Group (NSG) de Azure para mitigar ataques de denegacion de servicio (DoS), escaneos de fuerza bruta y explotacion de vulnerabilidades en el API Server desde internet publico.

Surgio la disyuntiva sobre como permitir la ejecucion de los despliegues sin degradar la postura de seguridad de la infraestructura.

---

## 2. Opciones Evaluadas

### Opcion 1: Apertura condicional del puerto 6443 en el NSG
- **Descripcion:** Abrir el puerto 6443 hacia internet o hacia los rangos de IP publicos de GitHub Actions.
- **Desventajas:** Los rangos CIDR de GitHub Actions cambian continuamente y abarcan miles de clientes compartidos. Exponer el plano de control a internet contradice el principio de minimo privilegio y las politicas de endurecimiento perimetral.

### Opcion 2: Tunel SSH efimero desde runners hospedados por GitHub
- **Descripcion:** Crear un tunel reverso o conexion SSH temporal desde el runner de GitHub hacia la VM antes de ejecutar `kubectl`.
- **Desventajas:** Requiere almacenar llaves privadas SSH en GitHub Secrets, abrir el puerto 22 o usar bastion hosts, agregando latencia y complejidad operativa al pipeline.

### Opcion 3 (Seleccionada): GitHub Actions Self-Hosted Runner dentro de la VM
- **Descripcion:** Instalar un runner self-hosted dedicado dentro de la misma maquina virtual de Azure que aloja K3s, etiquetado especificamente con `runs-on: [self-hosted, k3s-cluster]`.
- **Ventajas:**
  1. El runner establece una conexion saliente HTTPS (puerto 443) hacia GitHub; no se requiere abrir ningun puerto entrante en el NSG.
  2. Los comandos `kubectl` interactuan localmente via `https://127.0.0.1:6443` o archivo `kubeconfig` local con permisos estrictos de sistema de archivos (`0600`).
  3. Despliegues mas rapidos al eliminar la latencia de red hacia el API server y reusar caches locales.

---

## 3. Decision

Se adopta la **Opcion 3: Runner Self-Hosted dentro de la VM**.

Solo los jobs que ejecutan `kubectl` usan el runner; las validaciones (actor, SHA en `main`,
build exitoso) siguen en runners hospedados por GitHub:
```yaml
jobs:
  deploy:
    runs-on: [self-hosted, linux, k3s-cluster]
```

Instalación y rotación: `docs/runbooks/self-hosted-runner.md`.

### Medidas de Seguridad y Mitigacion de Riesgos
1. **Aislamiento de permisos:** El servicio del runner corre bajo el usuario de sistema `gh-runner`, sin sudo (`systemd` service).
2. **Identidad de mínimo privilegio, una por ambiente:** El runner **no** usa `/etc/rancher/k3s/k3s.yaml` (administrador del clúster). `deploy/cluster/ci-deployer.yaml` define dos ServiceAccounts con el ClusterRole `search-deployer` concedido solo por RoleBinding: `ci-deployer-dev` en `search-dev` y `ci-deployer-prod` en `search-prod`.
   - El kubeconfig **permanente** del runner (`0600`) es solo el de `ci-deployer-dev`: por sí solo el runner no puede tocar producción, ni nodos, `kube-system` o `monitoring`.
   - El token de `ci-deployer-prod` es el secret `KUBE_PROD_TOKEN` del environment `production`, que solo admite ramas protegidas (`main`). El job de `deploy-prod.yml` (tras validar `PROD_APPROVERS`) lo escribe en un kubeconfig temporal en `$RUNNER_TEMP` y lo borra al terminar. Un workflow de un PR no puede leer ese secret.
   - Se verifica con `kubectl auth can-i` (runbook).
3. **Alcance de repositorios:** El runner esta registrado exclusivamente a nivel de repositorio (`leviuuuwwu/proyectofinaldevmet`). Solo `deploy.yml` (`workflow_run` de `main`) y `deploy-prod.yml` (`workflow_dispatch` desde `main`, actor en `PROD_APPROVERS`) usan la label `k3s-cluster`; ningún workflow de `pull_request` la usa.
4. **Token de registro:** lo genera un administrador del repo en el momento de registrar (vence en 1 hora) y se entrega por canal privado; nunca se guarda en el repositorio.

### Riesgo aceptado
En un repositorio privado de una cuenta personal, GitHub no permite exigir aprobación antes de que un workflow de un colaborador use un runner self-hosted: cualquier colaborador con escritura podría abrir un PR que cambie un workflow a `runs-on: [self-hosted, k3s-cluster]` y ejecutar código en la VM. Se acepta porque: (a) el equipo son 4 colaboradores conocidos; (b) el runner solo tiene permisos en `search-dev` y `search-prod`, no en el clúster ni en la VM (sin sudo); (c) un cambio así queda visible en el PR y `main` exige revisión de CODEOWNERS (`/.github/workflows/`). Alternativas que lo eliminarían (runner efímero por job, organización con runner groups) superan el alcance y el presupuesto del proyecto.

---

## 4. Consecuencias

- **Positivas:**
  - Cumplimiento estricto de las directivas de seguridad (puerto 6443 permanece 100% cerrado en el NSG).
  - Eliminacion de dependencias de credenciales SSH efimeras en GitHub Secrets.
- **Negativas / Compromisos aceptados:**
  - Responsabilidad de mantenimiento del runtime del runner (versión fijada, actualizaciones) y rotacion del token de `ci-deployer` si alguien sale del equipo (runbook).
  - Paso manual documentado por VM: instalar y registrar el runner (condición 5.6).
  - Con la VM apagada (`infra/scripts/vm-stop.sh`) los despliegues quedan en cola hasta que vuelva.
  - Consumo de recursos locales (~80-120MB RAM), factor considerado dentro del dimensionamiento de la VM (Standard_B2ls_v2, 4 GB).
