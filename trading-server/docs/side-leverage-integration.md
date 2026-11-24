# 방향별 레버리지 연동 계약

사용자 확정에 따라 기존 AGENTS의 LONG/SHORT 공유 설정 조항을 이 기능에서 대체한다. 다른 Isolated/Hedge 정책은 유지한다.

- GET `/api/v1/trading/account/symbols/{symbolId}/leverage?side=LONG`: 방향 필수. 미지정/잘못된 방향은 400.
- PUT 동일 경로: `{"side":"LONG","leverage":20}`. Body 방향 필수. GET 쿼리 방향과 PUT Body 방향을 혼동하지 않는다.
- 응답: `tradingSymbolId`, `side`, `leverage`, `maxLeverage`, `marginMode`, `updatedAt`, `marginTransitionStatus`.
- Frontend는 LONG/SHORT별 설정을 조회하고 주문/quote에 동일 방향을 사용한다. 기존 방향 없는 PUT은 400이며 공유 변경으로 처리하지 않는다.
- LONG 설정 변경은 LONG 포지션 담보와 LONG PENDING OPEN 예약만 재배정한다. SHORT, 다른 종목, CLOSE 예약 수량, 과거 requestedLeverage/Fill은 보존한다.
- 수량·진입원가가 같으면 절대 PnL은 유지한다. 담보·ROE·청산 임계값은 변한다. 공통 지갑의 담보+예약+수수료 자금 검증과 AccountLock을 유지한다.
- 실패 시 전체 Transaction rollback. 기존 오류 코드와 Idempotency-Key 계약을 유지한다. 주문은 원래 키로 상태를 재확인한다.

## Migration / 재실행

V18은 공유 설정 한 행을 LONG/SHORT 두 행으로 복사한다. 기존 거래·담보를 변경하지 않는다. UNIQUE 키는 account/symbol/side다.
전체 구버전 Trading 앱·Worker를 중지하고 백업을 확보한 후 신버전을 실행한다. 구버전과 혼합 실행하지 않는다.
Flyway는 기존 연결·전용 운영 migration 계정을 사용한다. 신규 환경변수나 의존성은 없다. 실제 사용자 DB에는 이 작업에서 적용하지 않는다.
테스트: Java17/Docker Desktop 환경에서 `./gradlew clean build` (Windows `gradlew.bat clean build`). 테스트는 임시 PostgreSQL/Redis를 사용한다.
