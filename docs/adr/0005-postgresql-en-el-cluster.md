# ADR 0005: Despliegue de PostgreSQL dentro del clúster de Kubernetes

## Estado
Aceptado

## Contexto
El sistema requiere una base de datos relacional PostgreSQL para los ambientes `search-dev` y `search-prod` con aislamiento de datos entre ambientes. Se evaluó el uso de Azure Database for PostgreSQL Flexible Server frente al despliegue dentro del clúster K3s mediante StatefulSet.

## Decisión
Desplegar PostgreSQL 17 dentro del clúster mediante un `StatefulSet` por ambiente respaldado por el `StorageClass` `local-path` de K3s (volumen de 2Gi) con configuración controlada de memoria (`shared_buffers=64MB`, `max_connections=40`, límite de memoria 384Mi).

## Justificación
- Reducción de costos: Costo adicional US$0 frente a ~US$15/mes del servicio administrado.
- Ciclo de vida ligado a la VM: Al apagar la VM para ahorrar créditos, la base se detiene con ella (el servicio administrado se reactiva a los 7 días).
- Requerimiento académico (COM-03, sección 4.1): Permite demostrar el uso de StatefulSet, PVC y persistencia ante reinicio o eliminación de pods.

## Riesgos Aceptados
- Si se destruye el disco local de la VM, los datos persistidos se pierden (permitido por la rúbrica; los datos de prueba se regeneran con `datagen`).
- Topología de réplica única sin alta disponibilidad ni failover automático.
