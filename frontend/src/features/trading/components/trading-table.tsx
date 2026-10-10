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
    <div className="min-w-0 overflow-x-auto">
      <table className="trading-table" role="table">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup"><tr role="row">{columns.map((column) => <th key={column.key} scope="col" role="columnheader">{column.label}</th>)}</tr></thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={row.id} role="row">
              {columns.map((column) => <td key={column.key} data-label={column.label} role="cell">{row.cells[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
