// Display compression only; original decimal strings remain untouched for mutations.
export function compactQuantity(value: string, referencePrice?: string | null) {
  if (!/^\d+(\.\d+)?$/.test(value)) return "—";
  const [whole, fraction = ""] = value.split(".");
  const first = fraction.search(/[1-9]/);
  const price = referencePrice && /^\d+(\.\d+)?$/.test(referencePrice) ? referencePrice.split(".") : null;
  const priceWhole = price?.[0].replace(/^0+/, "") ?? "";
  const normalPlaces = !price ? 3 : priceWhole.length >= 4 ? 3 : priceWhole ? 6 : (price[1] ?? "").search(/[1-9]/) >= 4 ? 12 : 8;
  const places = Math.min(12, Math.max(normalPlaces, !whole.replace(/^0+/, "") && first >= normalPlaces ? first + 3 : 0));
  const scale = BigInt(10) ** BigInt(places);
  let rounded = BigInt(whole) * scale + BigInt(fraction.padEnd(places, "0").slice(0, places));
  if (fraction.charAt(places) >= "5") rounded += BigInt(1);
  const padded = rounded.toString().padStart(places + 1, "0");
  const digits = padded.slice(-places).replace(/0+$/, "");
  const result = `${padded.slice(0, -places).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${digits ? `.${digits}` : ""}`;
  return !/[1-9]/.test(result) && /[1-9]/.test(value) ? "<0.000000000001" : result;
}

export function TableQuantity({ value, unit, referencePrice }: { value: string; unit?: string; referencePrice?:string|null }) {
  const display = compactQuantity(value,referencePrice);
  const normalized = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const approximate = display.replaceAll(",", "") !== normalized;
  return <details className="table-quantity"><summary title={`${value}${unit ? ` ${unit}` : ""}`} aria-label={`수량 ${value}${unit ? ` ${unit}` : ""} · 정확값 보기`}>{approximate && <span aria-label="반올림 표시">≈</span>}{display}{unit && <small> {unit}</small>}</summary><span className="quantity-exact">정확한 수량: {value}{unit && ` ${unit}`}</span></details>;
}
