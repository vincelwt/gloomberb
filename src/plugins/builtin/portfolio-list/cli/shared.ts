import type { AppConfig } from "../../../../types/config";
import { findPortfolio, isManualPortfolio } from "../mutations";

export function parseFiniteNumber(rawValue: string | undefined, label: string): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return value;
}

export function requireManualPortfolio(config: AppConfig, rawName: string): NonNullable<ReturnType<typeof findPortfolio>> {
  const portfolio = findPortfolio(config, rawName);
  if (!portfolio) {
    throw new Error(`Portfolio "${rawName}" was not found.`);
  }
  if (!isManualPortfolio(portfolio)) {
    throw new Error(`Portfolio "${portfolio.name}" is broker-managed and cannot be modified manually.`);
  }
  return portfolio;
}
