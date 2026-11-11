# ADR 0006: Conectividad de Pipelines CI/CD hacia K3s mediante GitHub Actions Self-Hosted Runner

- **Estado:** Aceptado
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

Los workflows de despliegue (`deploy.yml` y `deploy-prod.yml`) definiran:
```yaml
jobs:
  deploy:
    runs-on: [self-hosted, k3s-cluster]
```

### Medidas de Seguridad y Mitigacion de Riesgos
1. **Aislamiento de permisos:** El servicio del runner corre bajo un usuario de sistema dedicado sin privilegios de sudo sin contraseña (`systemd` service).
2. **Acceso al Kubeconfig:** El runner accede al archivo `/etc/rancher/k3s/k3s.yaml` mediante un grupo POSIX restringido, asegurando que solo los procesos autorizados puedan interactuar con la API de Kubernetes.
3. **Alcance de repositorios:** El runner esta registrado exclusivamente a nivel de repositorio (`leviuuuwwu/proyectofinaldevmet`) y protegido contra ejecuciones de pull requests no autorizados desde forks.

---

## 4. Consecuencias

- **Positivas:**
  - Cumplimiento estricto de las directivas de seguridad (puerto 6443 permanece 100% cerrado en el NSG).
  - Eliminacion de dependencias de credenciales SSH efimeras en GitHub Secrets.
- **Negativas / Compromisos aceptados:**
  - Responsabilidad de mantenimiento del runtime del runner y rotacion de tokens en la VM.
  - Consumo de recursos locales (~80-120MB RAM), factor considerado dentro del dimensionamiento de la VM (Standard_B2s).
