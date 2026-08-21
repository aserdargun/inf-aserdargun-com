const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_DAY = 86_400n;
const UTC_INSTANT_PARTS = /^(.*?)(?:\.(\d+))?Z$/;

export interface UtcInstant {
  wholeSecondMilliseconds: number;
  fractionalSecond: string;
}

export function parseUtcInstant(timestamp: string): UtcInstant {
  const parts = UTC_INSTANT_PARTS.exec(timestamp);
  if (parts === null) throw new RangeError("Expected a valid UTC timestamp");

  const wholeSecondMilliseconds = Date.parse(`${parts[1]}Z`);
  if (!Number.isFinite(wholeSecondMilliseconds)) {
    throw new RangeError("Expected a valid UTC timestamp");
  }

  return { wholeSecondMilliseconds, fractionalSecond: parts[2] ?? "" };
}

export function utcInstantFrom(value: Date | string): UtcInstant {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new RangeError("Expected a valid timestamp");
    return parseUtcInstant(value.toISOString());
  }
  return parseUtcInstant(value);
}

function compareFractionalSeconds(left: string, right: string): number {
  const width = Math.max(left.length, right.length);
  const leftPadded = left.padEnd(width, "0");
  const rightPadded = right.padEnd(width, "0");
  if (leftPadded < rightPadded) return -1;
  if (leftPadded > rightPadded) return 1;
  return 0;
}

export function compareUtcInstants(left: UtcInstant, right: UtcInstant): number {
  if (left.wholeSecondMilliseconds < right.wholeSecondMilliseconds) return -1;
  if (left.wholeSecondMilliseconds > right.wholeSecondMilliseconds) return 1;
  return compareFractionalSeconds(left.fractionalSecond, right.fractionalSecond);
}

function fractionAsUnits(fractionalSecond: string, width: number): bigint {
  const padded = fractionalSecond.padEnd(width, "0");
  return padded === "" ? 0n : BigInt(padded);
}

function floorDivide(dividend: bigint, divisor: bigint): bigint {
  if (dividend >= 0n) return dividend / divisor;
  return -((-dividend + divisor - 1n) / divisor);
}

/** Returns floored elapsed UTC days while retaining every accepted fraction digit. */
export function elapsedWholeUtcDaysSince(timestamp: string, now: UtcInstant): number {
  const then = parseUtcInstant(timestamp);
  const width = Math.max(now.fractionalSecond.length, then.fractionalSecond.length);
  const scale = 10n ** BigInt(width);
  const elapsedUnits = (
    BigInt(now.wholeSecondMilliseconds / MILLISECONDS_PER_SECOND)
    - BigInt(then.wholeSecondMilliseconds / MILLISECONDS_PER_SECOND)
  ) * scale + fractionAsUnits(now.fractionalSecond, width) - fractionAsUnits(then.fractionalSecond, width);
  const elapsedDays = floorDivide(elapsedUnits, SECONDS_PER_DAY * scale);
  const result = Number(elapsedDays);
  if (!Number.isSafeInteger(result)) throw new RangeError("UTC day difference is out of range");
  return result;
}

/** Adds exact whole UTC days without truncating the original fractional second. */
export function addWholeUtcDays(timestamp: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError("days must be a safe integer");

  const instant = parseUtcInstant(timestamp);
  const dueMilliseconds = instant.wholeSecondMilliseconds + days * MILLISECONDS_PER_DAY;
  if (!Number.isFinite(dueMilliseconds)) throw new RangeError("Scheduled UTC instant is out of range");

  const wholeSecondIso = new Date(dueMilliseconds).toISOString();
  if (instant.fractionalSecond === "") return wholeSecondIso;
  return `${wholeSecondIso.slice(0, -5)}.${instant.fractionalSecond}Z`;
}
