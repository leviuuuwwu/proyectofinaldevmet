# Presupuesto mensual y alertas de costo (DEV-13, 5.9). Limitado al Resource
# Group del stack principal, que es el único scope donde el Service Principal
# de CI tiene permisos (ver ADR 0004). Notifica a quien tenga rol Owner en ese
# scope, para no versionar correos personales.
resource "azurerm_consumption_budget_resource_group" "monthly" {
  name              = "budget-search-monthly"
  resource_group_id = data.azurerm_resource_group.rg.id

  amount     = var.monthly_budget_amount
  time_grain = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 50
    threshold_type = "Actual"
    contact_roles  = ["Owner"]
  }

  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 80
    threshold_type = "Actual"
    contact_roles  = ["Owner"]
  }

  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 100
    threshold_type = "Actual"
    contact_roles  = ["Owner"]
  }

  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 100
    threshold_type = "Forecasted"
    contact_roles  = ["Owner"]
  }
}
