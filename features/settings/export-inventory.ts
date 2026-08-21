import type { SettingsHealthResponse } from "@inf/contracts";

export const INVENTORY_SCHEMA_VERSION = 1 as const;

export function inventoryDocument(health: SettingsHealthResponse, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    exportedAt,
    items: [...health.recovery.items].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function downloadInventory(health: SettingsHealthResponse): void {
  const payload = inventoryDocument(health);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "inf-inventory-v1.json"; anchor.style.display = "none";
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
