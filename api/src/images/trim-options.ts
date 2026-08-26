import type { AutoTrimConfig } from "./auto-trim.js";

export type { AutoTrimConfig } from "./auto-trim.js";

const DISABLED_VALUES = new Set(["false", "0", "no", "off", "disabled"]);
const ENABLED_VALUES = new Set(["true", "1", "yes", "on", "enabled"]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (DISABLED_VALUES.has(normalized)) return false;
  if (ENABLED_VALUES.has(normalized)) return true;
  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseUnitInterval(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

const DEFAULTS: Omit<AutoTrimConfig, "enabled"> = {
  threshold: 10,
  minSavingsRatio: 0.02,
  minDimension: 100,
  maxPixels: 40_000_000,
};

export function loadAutoTrimConfig(env: NodeJS.ProcessEnv = process.env): AutoTrimConfig {
  return {
    enabled: parseBoolean(env.INF_AUTO_TRIM_SCREENSHOTS, true),
    threshold: Math.floor(parsePositiveNumber(env.INF_AUTO_TRIM_THRESHOLD, DEFAULTS.threshold)),
    minSavingsRatio: parseUnitInterval(env.INF_AUTO_TRIM_MIN_SAVINGS, DEFAULTS.minSavingsRatio),
    minDimension: Math.floor(parsePositiveNumber(env.INF_AUTO_TRIM_MIN_DIMENSION, DEFAULTS.minDimension)),
    maxPixels: Math.floor(parsePositiveNumber(env.INF_AUTO_TRIM_MAX_PIXELS, DEFAULTS.maxPixels)),
  };
}

export const DISABLED_AUTO_TRIM: AutoTrimConfig = { enabled: false, ...DEFAULTS };
