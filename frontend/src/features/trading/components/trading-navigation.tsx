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
          onKeyDown={(event) => {
            if (!onSelect) return;
            const index = tabs.findIndex((item) => item.id === tab.id);
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
              : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
              : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            onSelect(tabs[next].id);
            document.getElementById(`${prefix}-${tabs[next].id}-tab`)?.focus();
          }}
          onClick={() => onSelect?.(tab.id)} className="trading-tab">
          {tab.label}{tab.count !== undefined && <span className="account-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
