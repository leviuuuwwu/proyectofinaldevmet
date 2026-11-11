# Costos observados (DEV-14)

[`cost-management-2026-11-11.png`](cost-management-2026-11-11.png) muestra Cost Management del
resource group `rg-search-devmet` en noviembre de 2026:

- **Costo real:** 0.02 USD, repartido entre storage (disco del SO), red virtual, ancho de banda
  e IP pública.
- **Presupuesto:** `budget-search-devmet` de 40 USD/mes, con alertas al 50, 80 y 100 %
  (`infra/budget.tf`).
- **Retraso del reporte:** Azure informa los cargos con 8 a 24 h de retraso, así que las horas
  de cómputo de hoy todavía no se reflejan.

La estimación (≈21 USD/mes con uso realista: VM encendida solo en horas de trabajo y
desasignada el resto) y el procedimiento de apagado (`infra/scripts/vm-stop.sh`) están en
[`docs/runbooks/costos-y-reconstruccion.md`](../../runbooks/costos-y-reconstruccion.md).

La captura se recortó para quitar la barra superior del portal, que mostraba la cuenta personal.
