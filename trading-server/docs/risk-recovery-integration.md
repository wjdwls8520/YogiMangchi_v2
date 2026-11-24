# 가격 위험 작업 복구 / Frontend 연동

## 처리 보장

PostgreSQL risk_price_event에 수신 이벤트를 기록하고, 당시 OPEN/PENDING 노출을 가진 계정에 risk_account_work를 같은 Transaction에서 만든다. Redis Stream/PubSub는 공유·전송 경로이며 위험 작업의 유일한 원본이 아니다. 전체 가격 기록과 대상 작업 생성이 commit된 뒤 수신 callback이 완료된다.

금융 요청과 수신 기록 사이에 PostgreSQL Transaction advisory shared/exclusive fence를 사용한다. 금융 요청끼리는 shared이므로 계정 간 직렬화가 아니다. 기존 AccountLock·Wallet·Position·Order·Fill Transaction을 유지한다. 수신은 exclusive 경계에서 commit된 노출을 읽고, 해당 계정의 미처리 작업이 있으면 이후 주문/quote/레버리지/부분 종료/취소/재시작 변경을 거절한다. 과거에 존재하지 않던 노출에 오래된 가격을 대입하지 않는다.

재처리는 수신 당시 유효하게 검증된 journal 가격만 사용한다. 현재 주문 가격 freshness와 다르다. 지연된 작업은 현재 Mark가 회복됐더라도 수신한 crossing 순서대로 처리하며, 체결 priceEventTime은 원래 가격 시각, executedAt은 실제 처리 시각이다. 현재 MARKET/quote/레버리지 변경은 계속 fresh Mark가 필요하다. 일반 서비스 호출로 임의의 오래된 가격을 승인할 수 없도록 영속 작업 실행 경계의 permit을 사용한다.

각 계정은 event_id 순서로 처리하며 Fill/개인 이벤트/Wallet 변경과 작업 DONE이 같은 금융 Transaction에서 commit된다. 전체 dispatch checkpoint와 계정 진행 상태를 분리하므로 dispatch 저장 전후 장애·재시작·Redis trim이 중복 정산을 만들지 않는다. 기본 Worker는 journal을 읽고, 기존 Redis 경로는 별도 테스트 설정에서 과거 회귀 검증을 위해 유지한다. 신규 운영 경로는 기본 활성화며 기존 경로로 되돌려 배포하지 않는다.

계정 처리 실패는 rollback 후 별도 Transaction으로 실패 횟수·안전한 코드만 보존한다. 자동 재시도는 최대3회, 지연2/4초 후 재시도하며3회차는 HELD다. 실패 계정의 후속 이벤트는 보류하지만 다른 계정은 계속 처리한다. 운영자가 원인을 수정하고 명시적으로 재시도하면 새3회 예산을 부여하며 기존 시도 이력은 유지한다. 글로벌 PG 장애는 Worker 지수 backoff1~30초와 global RECOVERING으로 표현한다.

## 복구할 수 없는 구간

공급자 연결 단절/재구독, 수신 기록 실패, 마지막 수신 후5초를 초과한 구간은 실제 경로를 알 수 없다. 이전 노출을 가진 계정·종목에 risk_hold를 영속 기록하고, 새 fresh 가격만으로 자동 해제하지 않는다. 원래 수신된 이전 작업은 순서대로 처리할 수 있지만 hold 이후 작업/새 금융 변경은 검토 전 보류한다. 봉 high/low로 사건 순서를 추측하거나 가짜 Fill·임의 잔액 조정을 만들지 않는다.

운영자는 원인·미수신 시간·영향 주문/포지션과 원장을 확인한 뒤 ops/review-price-gap.sql로 특정 hold만 근거(ticket)를 남겨 재개할 수 있다. 이는 과거 미수신 crossing을 복원했다는 뜻이 아니다. 자동 복원이 불가능한 잔여 위험을 명시적으로 판단해야 한다. 반복 실패는 ops/retry-risk-work.sql을 사용한다. 두 스크립트는 금융 값을 수정하지 않는다. 접근 권한과 운영 검토는 배포 환경에서 제한한다.

기존 Content→Trading 탈퇴 전파 지연 정책은 유지한다. 최종 탈퇴는 PENDING/예약/OPEN 노출 정리를 기존 방식으로 마치고, 남은 위험 작업은 MEMBER_WITHDRAWAL로 RETIRED 처리한다. 회차/Guest 재시작은 미처리 위험 작업을 먼저 처리해야 하며, 작업에 저장된 회차/Guest generation이 바뀌었으면 과거 작업으로 새 회차를 정산하지 않는다. 기존 Cross 전환은 최신 fresh event와 전체 fresh 위험 검증이 가능한 경우에만 승인하고, 오래된 검증만 남은 노출은 검토 보류한다.

## API / Frontend

- 글로벌 `GET /api/v1/trading/status`는 기존 READY/RECOVERING 의미를 유지한다.
- `GET /api/v1/trading/account/recovery`는 인증 계정만 조회한다. status=CLEAR/PENDING/REVIEW_REQUIRED, pendingWork/heldWork, oldestRiskEventId/oldestReceivedAt, holds(holdId,tradingSymbolId,riskEventId,reason,heldAt), capturedAt. no-store.
- 신규503 ACCOUNT_RISK_PENDING은 받은 위험 작업 대기, ACCOUNT_RECOVERY_HELD는 검토 보류다. 응답에 riskEventId/referenceTime/outcome=NOT_ACCEPTED를 제공한다. 상세 scope는 recovery API로 조회한다. 내부 SQL/예외/토큰은 응답하지 않는다.
- ENGINE_RECOVERING(글로벌 입장/가격 처리 미완료), PRICE_NOT_FRESH(현재 Mark 미가용), MARGIN_MIGRATION_REQUIRED(기존 Cross 전환), ACCOUNT_AT_RISK(현재 노출 위험)는 구분한다.
- Frontend는 REVIEW_REQUIRED에 무한 자동 주문 재시도를 하지 않는다. PENDING은 처리 후 재조회하고 원래 Idempotency-Key로 주문 결과를 확인한다. 예상하지 못한500은 code=INTERNAL_ERROR/outcome=UNKNOWN, 업무 거절은 outcome=NOT_ACCEPTED다. 응답 유실/네트워크 오류도 확정 거절로 표시하지 않는다. 기존 Order API의 orderId/status/reason과 개인 이벤트 cursor 재개 계약을 유지한다.
- 기존 거절: INSUFFICIENT_MARGIN은 담보+수수료/정산 현금 부족, POSITION_LIMIT_REACHED는 포지션 수 상한, ORDER_SIZE_LIMIT_EXCEEDED는 주문/통합 포지션 거래대금 상한, SYMBOL_NOT_AVAILABLE은 종목 중단, POSITION_LIQUIDATION은 대상 청산이다. 체결 후 결과와 접수 단계 오류의 구분을 유지한다.

## 배포 / 환경 / 재실행

V19 새 테이블·인덱스만 추가하며 과거 Fill/Wallet을 변경하지 않는다. 전체 구버전 Trading 앱/Worker를 중지하고 백업 후 기존 Flyway 계정으로 적용한다. V18 방향별 레버리지와 함께 배포할 때는 버전 순서대로 적용하고 Frontend의 side 계약을 먼저 확인한다. 신규 외부 의존성·Secret·필수 환경변수는 없다. 기존 TRADING_* DB/Redis 설정을 사용한다.

테스트 전용 설정 trading.risk-journal.enabled=false는 기존 Redis 회귀용이다. 운영에 사용하지 않는다. 신규 경로가 기본true다. 테스트는 임시 PostgreSQL17/Redis7, 외부 Binance 없이 수행한다. 실제 사용자 DB/Volume은 이 작업에서 변경하지 않는다.

Java17/Docker 환경에서 `trading-server/gradlew.bat -p trading-server clean build`. Worker 재시작 시 영속 checkpoint와 PENDING 작업을 읽는다. HELD는 재시작으로 초기화하지 않는다. 원장/가격 기록의 자동 삭제는 도입하지 않았으며 운영 보관 용량·보존기간은 공개 전 결정해야 한다. 현재 단일 Worker 경계이며 다중 Worker 운영 전 dispatch 소유권을 별도 검증해야 한다.

과거 원장의 POSITION_LIMIT, SYMBOL_NOT_ACTIVE, UNSUPPORTED_EXECUTION_NOTIONAL, INSUFFICIENT_SETTLEMENT_CASH는 수정하지 않는다. 신규 결과는 각각 POSITION_LIMIT_REACHED, SYMBOL_NOT_AVAILABLE, ORDER_SIZE_LIMIT_EXCEEDED 또는 INVALID_ORDER, INSUFFICIENT_MARGIN으로 통일한다. Frontend는 이력 표시에서 과거 alias를 계속 지원한다.

## 보장 경계와 측정

PG commit 전에 입력 수락이 실패한 가격은 영속 복원을 보장할 수 없다. DB 복구 시 실패한 **모든 종목**과 최초 미기록 시각을 hold에 남긴다. 프로세스까지 재시작되면 최초 재구독이 기존 노출 전체의 미확인 구간을 보류한다. 정상 commit된 journal 이벤트와 이 미승인 구간을 구분한다. 어떤 경우에도 수신하지 못한 실제 가격 경로를 만들어내지 않는다.

로컬 임시 PostgreSQL17/Redis7에서20계정 지정가 crossing을 측정한 실행:20 Fill, 누락0/중복0, 실제 JDBC 실행450회/SELECT 조회248회(측정·poll 조회 포함), 마지막 수신→commit 관측 최대540ms, 기록→commit 최대534ms, lock timeout0. 실제 Transaction proxy가 반환한 뒤 관측했다. 작은 로컬 대표 시나리오이며 운영 TPS나 수용 인원 보장은 아니다. 재현 테스트는 실제값과 EXPLAIN ANALYZE BUFFERS JSON을 RISK_MEASUREMENT로 출력한다.
