export function AccountQueryState({ loading, error, empty, onRetry, busy = false }: {
  loading: boolean; error: boolean; empty?: string; onRetry: () => void; busy?: boolean;
}) {
  if (!loading && !error && !empty) return null;
  return <div className="account-query-state" role="status" aria-live="polite" aria-busy={loading || busy}>
    <p>{error ? "계정 데이터를 불러오지 못했습니다. 연결을 확인한 뒤 다시 조회해 주세요. 확인 전에는 잔액과 거래 상태를 알 수 없습니다." : loading ? "계정 데이터를 불러오는 중입니다." : empty}</p>
    {error && <button className="account-refresh" type="button" onClick={onRetry} disabled={busy}>다시 시도</button>}
  </div>;
}
