import type { ReactNode } from "react";

export type TradingColumn = { key: string; label: string };
export type TradingRow = { id: string; cells: Record<string, ReactNode> };

// One semantic table per dataset; design adapts these same rows for narrow screens.
export function TradingTable({ caption, columns, rows }: {
  caption: string;
  columns: readonly TradingColumn[];
  rows: readonly TradingRow[];
}) {
  return (
    <div className="overflow-x-auto">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column.key} data-label={column.label}>{row.cells[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
