# ADR 0002: Aprobación y Despliegue Manual a Producción en Repositorio Privado

## Estado
Aceptado

## Contexto
El repositorio del proyecto es privado bajo una organización o cuenta sin GitHub Enterprise. En los planes estándar para repositorios privados, GitHub no permite configurar "Required Reviewers" nativos en las reglas de protección de Environments (`production`).
Por requerimientos de entrega continua segura (DEV-05), los despliegues a producción no deben ser automáticos tras el paso por desarrollo, sino que deben estar sujetos a autorización humana y ejecutarse únicamente con versiones probadas y aprobadas en `main`.

## Decisión
Implementar un flujo de despliegue a producción manual mediante `workflow_dispatch` en `.github/workflows/deploy-prod.yml` que cumple con las siguientes restricciones:
1. **Validación de Actor (`PROD_APPROVERS`):** Solo las identidades listadas en la variable de organización/repositorio `vars.PROD_APPROVERS` tienen permiso para ejecutar el workflow. Si un usuario no autorizado lo dispara, el pipeline aborta de inmediato.
2. **Origen exclusivo desde `main`:** El workflow solo puede dispararse tomando como referencia `refs/heads/main`.
3. **Validación criptográfica del Commit (`image_sha`):** El parámetro obligatorio `image_sha` debe ser un commit SHA válido de 40 dígitos hexadecimales que ya pertenezca al historial de `main` (`git merge-base --is-ancestor`) y que cuente con una ejecución exitosa previa del pipeline `App Delivery`.

## Por qué es una aprobación válida
Cualquier modificación a la lista de aprobadores (`vars.PROD_APPROVERS`) o a la lógica del workflow requiere un Pull Request dirigido a `main`, el cual pasa obligatoriamente por la protección de ramas, pruebas de CI y revisión de pares según `CODEOWNERS`.

## Limitaciones
Cualquier persona incluida en `vars.PROD_APPROVERS` puede ejecutar el despliegue a producción de forma autónoma sin requerir la firma concurrente de un segundo aprobador durante el evento `workflow_dispatch`.

## Alternativas descartadas
1. **Hacer el repositorio público:** Descartado para proteger la infraestructura, configuraciones y credenciales del equipo antes de la entrega final.
2. **Adquirir GitHub Enterprise:** Descartado por costos y alcance del proyecto académico.
