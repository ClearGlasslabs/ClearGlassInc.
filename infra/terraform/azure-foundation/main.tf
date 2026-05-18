terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "clearglass_rg" {
  name     = "clearglass-platform-rg"
  location = "East US"
}

resource "azurerm_log_analytics_workspace" "law" {
  name                = "clearglass-law"
  location            = azurerm_resource_group.clearglass_rg.location
  resource_group_name = azurerm_resource_group.clearglass_rg.name
  sku                 = "PerGB2018"
}

resource "azurerm_application_insights" "appi" {
  name                = "clearglass-appinsights"
  location            = azurerm_resource_group.clearglass_rg.location
  resource_group_name = azurerm_resource_group.clearglass_rg.name
  workspace_id        = azurerm_log_analytics_workspace.law.id
  application_type    = "web"
}

resource "azurerm_key_vault" "kv" {
  name                       = "clearglasskeyvault01"
  location                   = azurerm_resource_group.clearglass_rg.location
  resource_group_name        = azurerm_resource_group.clearglass_rg.name
  tenant_id                  = "00000000-0000-0000-0000-000000000000"
  sku_name                   = "standard"
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
}
