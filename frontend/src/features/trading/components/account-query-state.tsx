export function AccountQueryState({ loading, error, empty, onRetry, busy = false }: {
  loading: boolean; error: boolean; empty?: string; onRetry: () => void; busy?: boolean;
}) {
  if (!loading && !error && !empty) return null;
  return <div className="account-query-state" role="status" aria-live="polite" aria-busy={loading || busy}>
    <p>{error ? "계정 데이터를 불러오지 못했습니다. 연결과 브라우저 저장소 설정을 확인해 주세요." : loading ? "계정 데이터를 불러오는 중입니다." : empty}</p>
    {error && <button className="account-refresh" type="button" onClick={onRetry} disabled={busy}>다시 시도</button>}
  </div>;
}
