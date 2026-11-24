// Exchange-standard decimal display formatters (Binance Futures / Bybit / OKX / Upbit conventions).
// Display-layer only: preserves exact server BigDecimal wire values without floating-point drift.

interface ParsedDecimal {
  negative: boolean;
  whole: string;
  fraction: string;
}

function parsePlainDecimal(raw: string | number | null | undefined): ParsedDecimal | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw)
    .replace(/,/g, "")
    .replace(/\s*USDT$/i, "")
    .replace(/^\$/, "")
    .replace(/%$/, "")
    .trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;

  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (match) {
    const sign = match[1] ?? "";
    const whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "") || "0";
    const fraction = match[3] ?? "";
    const hasNonZero = /[1-9]/.test(whole) || /[1-9]/.test(fraction);
    return {
      negative: sign === "-" && hasNonZero,
      whole,
      fraction,
    };
  }

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;
  if (numeric === 0) {
    return { negative: false, whole: "0", fraction: "" };
  }
  const fixed = Math.abs(numeric).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  const [whole = "0", fraction = ""] = fixed.split(".");
  return {
    negative: numeric < 0,
    whole: whole.replace(/^0+(?=\d)/, "") || "0",
    fraction,
  };
}

function addThousandsCommas(digits: string): string {
  return (digits.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function roundHalfUpUnsigned(whole: string, fraction: string, scale: number): {
  whole: string;
  fraction: string;
  isZero: boolean;
} {
  const safeScale = Math.max(0, Math.min(18, Math.trunc(scale)));
  const factor = BigInt(10) ** BigInt(safeScale);
  const fracSlice = fraction.padEnd(safeScale + 1, "0");
  const mainDigits = fracSlice.slice(0, safeScale);
  const guardDigit = fracSlice.charAt(safeScale);

  let scaled = BigInt(whole || "0") * factor + (mainDigits ? BigInt(mainDigits) : BigInt(0));
  if (guardDigit >= "5") {
    scaled += BigInt(1);
  }

  if (scaled === BigInt(0)) {
    return {
      whole: "0",
      fraction: "0".repeat(safeScale),
      isZero: true,
    };
  }

  if (safeScale === 0) {
    return {
      whole: scaled.toString(),
      fraction: "",
      isZero: false,
    };
  }

  const padded = scaled.toString().padStart(safeScale + 1, "0");
  return {
    whole: padded.slice(0, -safeScale) || "0",
    fraction: padded.slice(-safeScale),
    isZero: false,
  };
}

function formatRoundedNumber(
  parsed: ParsedDecimal,
  maxDecimals: number,
  minDecimals: number,
): { formatted: string; isZero: boolean; negative: boolean } {
  const rounded = roundHalfUpUnsigned(parsed.whole, parsed.fraction, maxDecimals);
  const wholeWithCommas = addThousandsCommas(rounded.whole);

  if (maxDecimals <= 0) {
    return {
      formatted: `${parsed.negative && !rounded.isZero ? "-" : ""}${wholeWithCommas}`,
      isZero: rounded.isZero,
      negative: parsed.negative && !rounded.isZero,
    };
  }

  const safeMin = Math.max(0, Math.min(maxDecimals, minDecimals));
  const mandatory = rounded.fraction.slice(0, safeMin);
  const optional = rounded.fraction.slice(safeMin).replace(/0+$/, "");
  const fracJoined = `${mandatory}${optional}`;
  const signPrefix = parsed.negative && !rounded.isZero ? "-" : "";

  return {
    formatted: fracJoined ? `${signPrefix}${wholeWithCommas}.${fracJoined}` : `${signPrefix}${wholeWithCommas}`,
    isZero: rounded.isZero,
    negative: parsed.negative && !rounded.isZero,
  };
}

function inferTickDecimals(tickSize?: string | null): number | null {
  if (!tickSize) return null;
  const parsed = parsePlainDecimal(tickSize);
  if (!parsed) return null;
  const trimmed = parsed.fraction.replace(/0+$/, "");
  if (trimmed.length === 0) {
    return parsed.whole === "0" ? null : 0;
  }
  return Math.min(8, trimmed.length);
}

/**
 * Exchange-standard USDT balance / equity / margin / notional formatter:
 * Fixed 2 decimal places with thousands separator (e.g., "9,632.45 USDT", "0.00 USDT").
 */
export function formatExchangeUsdt(raw: string | number | null | undefined): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "0.00 USDT";
  const { formatted } = formatRoundedNumber(parsed, 2, 2);
  return `${formatted} USDT`;
}

/**
 * Exchange-standard signed PnL formatter:
 * "+184.20 USDT", "-367.55 USDT", or neutral "0.00 USDT" (never "+0.00" or "-0.00").
 */
export function formatExchangeSignedUsdt(raw: string | number | null | undefined): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "0.00 USDT";
  const { formatted, isZero, negative } = formatRoundedNumber(parsed, 2, 2);
  if (isZero) return "0.00 USDT";
  return negative ? `${formatted} USDT` : `+${formatted} USDT`;
}

/**
 * Exchange-standard trading fee formatter:
 * Shows 2 decimals for normal fees (>= 0.01 USDT), or up to 6 decimals for micro-fees
 * (< 0.01 USDT) so non-zero fees never display as "0.00 USDT".
 */
export function formatExchangeFeeUsdt(raw: string | number | null | undefined): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "0.00 USDT";
  const isZeroInput = parsed.whole === "0" && !/[1-9]/.test(parsed.fraction);
  if (isZeroInput) return "0.00 USDT";

  const isMicro =
    parsed.whole === "0" &&
    (parsed.fraction.length === 0 || parsed.fraction.slice(0, 2) === "00");
  if (isMicro) {
    const micro = formatRoundedNumber(parsed, 6, 2);
    return `${micro.formatted} USDT`;
  }
  const normal = formatRoundedNumber(parsed, 2, 2);
  return `${normal.formatted} USDT`;
}

/**
 * Exchange-standard seed money formatter:
 * Strips insignificant ".00..." on integer seeds ("10,000 USDT"), keeps 2 decimals otherwise.
 */
export function formatExchangeSeedUsdt(raw: string | number | null | undefined): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "0 USDT";
  const { formatted } = formatRoundedNumber(parsed, 2, 0);
  if (formatted.includes(".")) {
    const fixedTwo = formatRoundedNumber(parsed, 2, 2);
    return `${fixedTwo.formatted} USDT`;
  }
  return `${formatted} USDT`;
}

/**
 * Exchange-standard signed ROI / ROE percentage formatter:
 * "+18.42%", "-3.68%", or neutral "0.00%".
 */
export function formatExchangeSignedPct(raw: string | number | null | undefined): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "0.00%";
  const { formatted, isZero, negative } = formatRoundedNumber(parsed, 2, 2);
  if (isZero) return "0.00%";
  return negative ? `${formatted}%` : `+${formatted}%`;
}

/**
 * Exchange-standard unsigned ratio / allocation / win-rate percentage formatter:
 * Fixed `decimals` places (default 2, e.g. "34.61%", "65.39%").
 */
export function formatExchangePct(
  raw: string | number | null | undefined,
  decimals = 2,
): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return `${(0).toFixed(Math.max(0, decimals))}%`;
  const { formatted } = formatRoundedNumber({ ...parsed, negative: false }, decimals, decimals);
  return `${formatted}%`;
}

/**
 * Compact ratio percentage for Long/Short bar labels:
 * Rounds to 2 decimals and trims trailing zeros ("100%", "0%", "64.29%", "62.5%").
 */
export function formatExchangeCompactPct(raw: string | number | null | undefined): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "0%";
  const { formatted } = formatRoundedNumber({ ...parsed, negative: false }, 2, 0);
  return `${formatted}%`;
}

/**
 * Exchange-standard asset price formatter (without currency prefix/suffix):
 * Honors symbol `tickSize` when available; otherwise applies Binance/Bybit magnitude precision:
 * - >= 100: 2 decimals ("94,280.50")
 * - 1 .. < 100: 2..4 decimals ("14.50", "1.2345")
 * - 0.01 .. < 1: 4 decimals ("0.5820", "0.3820")
 * - 0.0001 .. < 0.01: 4..6 decimals ("0.008412")
 * - < 0.0001: 6..8 decimals ("0.00000984")
 */
export function formatExchangePrice(
  raw: string | number | null | undefined,
  tickSize?: string | null,
): string {
  const parsed = parsePlainDecimal(raw);
  if (!parsed) return "-";
  const isZeroInput = parsed.whole === "0" && !/[1-9]/.test(parsed.fraction);
  if (isZeroInput) return "-";

  const tickDecimals = inferTickDecimals(tickSize);
  if (tickDecimals !== null) {
    const minDec = tickDecimals === 0 ? 0 : Math.min(tickDecimals, parsed.whole === "0" ? tickDecimals : Math.max(2, tickDecimals));
    return formatRoundedNumber({ ...parsed, negative: false }, tickDecimals, minDec).formatted;
  }

  if (parsed.whole !== "0") {
    const wholeVal = BigInt(parsed.whole);
    if (wholeVal >= BigInt(100)) {
      return formatRoundedNumber({ ...parsed, negative: false }, 2, 2).formatted;
    }
    return formatRoundedNumber({ ...parsed, negative: false }, 4, 2).formatted;
  }

  const leadingZeros = /^0*/.exec(parsed.fraction)?.[0].length ?? 0;
  if (leadingZeros <= 1) {
    // 0.01 <= price < 1 (e.g. XRP 0.5820, DOGE 0.3820)
    return formatRoundedNumber({ ...parsed, negative: false }, 4, 4).formatted;
  }
  if (leadingZeros <= 3) {
    // 0.0001 <= price < 0.01
    return formatRoundedNumber({ ...parsed, negative: false }, 6, 4).formatted;
  }
  // < 0.0001 (e.g. PEPE / SHIB 0.00000984)
  return formatRoundedNumber({ ...parsed, negative: false }, 8, 6).formatted;
}

/**
 * Exchange-standard coin quantity formatter:
 * Rounds up to 6 decimals (or 8 for micro quantities) and strips all trailing zeros
 * ("0.05000000" -> "0.05", "1000000.00000000" -> "1,000,000", "0.00000000" -> "0").
 */
export function formatExchangeQuantity(
  raw: string | number | null | undefined,
  baseSymbol?: string,
): string {
  const parsed = parsePlainDecimal(raw);
  const unitSuffix = baseSymbol ? ` ${baseSymbol}` : "";
  if (!parsed) return `0${unitSuffix}`;

  const isZeroInput = parsed.whole === "0" && !/[1-9]/.test(parsed.fraction);
  if (isZeroInput) return `0${unitSuffix}`;

  const leadingZeros = parsed.whole === "0" ? (/^0*/.exec(parsed.fraction)?.[0].length ?? 0) : 0;
  const maxDecimals = leadingZeros >= 4 ? 8 : 6;
  const { formatted } = formatRoundedNumber({ ...parsed, negative: false }, maxDecimals, 0);
  return `${formatted}${unitSuffix}`;
}
