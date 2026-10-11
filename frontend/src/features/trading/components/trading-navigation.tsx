export type TradingTab = { id: string; label: string; controls: string; count?: number };

export function TradingNavigation({ label, prefix, tabs, activeId, onSelect, className = "" }: {
  label: string;
  prefix: string;
  tabs: readonly TradingTab[];
  activeId: string;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`trading-navigation ${className}`}>
      {tabs.map((tab) => (
        <button key={tab.id} id={`${prefix}-${tab.id}-tab`} type="button" role="tab"
          aria-selected={activeId === tab.id} aria-controls={tab.controls}
          tabIndex={activeId === tab.id ? 0 : -1} disabled={!onSelect}
          onClick={() => onSelect?.(tab.id)} className="trading-tab">
          {tab.label}{tab.count !== undefined && <span className="account-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
