// Display-only fixtures. Decimal values stay as strings; no trading calculations.
export const previewMarket = {
  symbol: "BTC",
  quote: "USDT",
  name: "Bitcoin",
  price: "64,580.20",
  change: "+2.34%",
  changeAmount: "+1,476.50",
  markPrice: "64,579.80",
  high: "65,210.00",
  low: "62,840.10",
  volume: "1.28B",
} as const;

export const previewSymbols = [
  { symbol: "BTC", name: "Bitcoin", price: "64,580.20", change: "+2.34%", trend: "up" },
  { symbol: "ETH", name: "Ethereum", price: "3,421.80", change: "+1.82%", trend: "up" },
  { symbol: "SOL", name: "Solana", price: "148.62", change: "−0.76%", trend: "down" },
  { symbol: "XRP", name: "XRP", price: "0.5284", change: "+0.43%", trend: "up" },
  { symbol: "DOGE", name: "Dogecoin", price: "0.1248", change: "−1.12%", trend: "down" },
] as const;
