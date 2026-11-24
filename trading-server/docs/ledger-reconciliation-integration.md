# 원장 대사 / 복구 연동

## 범위와 보장

기존 AccountLock 아래 같은 계정의 Wallet·OPEN Position·PENDING Order·Fill·Guest 재도전·회원 회차 원장을 읽는다. usedMargin=OPEN 담보 합, reservedMargin=PENDING OPEN 예약 합(수수료 포함), Position 종료 예약=PENDING CLOSE 수량 합을 검증한다. Wallet 누적 Gross PnL·수수료·격리 조정액은 실제 Fill 합과 비교한다. 종료 회차의 동결 원장, 다음 회차 baseline, 재시작 자본조정도 검증한다.

Guest의 확인된 최초10000 + Fill 순현금 손익 + 재도전 자본조정으로 잔액을 검증한다. 회원은 확인된 최신 회차 initialBalance + 해당 회차 Fill 순현금 손익을 사용하고, 과거 회차와 재시작 자본 이동을 별도 확인한다. LEGACY_UNVERIFIED 초기 자본은 추측하지 않는다. 구조·원장은 검증하되 자본 대사는 UNVERIFIED와 null expected_balance로 남긴다. 재도전/재시작 지급금·관리상 종료는 투자수익이나 가짜 Fill로 만들지 않는다.

금융 데이터는 읽기 전용이다. 대사 결과와 진단용 snapshot만 ledger_reconciliation에 저장한다. 불일치가 있으면 risk_hold에 원래 증거와 LEDGER_MISMATCH를 기록하며 해당 계정은 ACCOUNT_RECOVERY_HELD다. 다른 계정은 계속 거래한다. 정상 재검사나 앱 재시작으로 hold를 자동 해제하지 않는다. 원래 불일치 증거는 hold에 남고 최신 검사 결과는 snapshot을 갱신한다. 최종 회원 탈퇴의 기존 행정 정리는 유지한다.

## 비용 / 실행

기본 활성화, 앱 준비60초 후부터60초 간격, 최대25계정 keyset 배치다. 각 계정은 별도 Transaction(5초), 기존 AccountLock timeout2초, SQL timeout1초를 사용한다. 실패/경합 계정은 다음 순회에서 재검사하며 다른 계정의 scan을 막지 않는다. cursor는 영속 저장한다. 한 순회에 여러 배치가 필요하므로 운영자는 checked_at 미존재·지연을 감시하고 계정 수와 실제 부하에 따라 검사 주기를 검토해야 한다. 이는 모든 요청마다 수행하는 동기 검사가 아니다. 반복되는 검사 자체의 오류는 원장 불일치로 위장하지 않으며 로그·검사 지연으로 식별한다.

임시 PostgreSQL17/Redis7의10계정·20 Fill 측정 실행: 계정당 검사 최대8.34ms, 전체 JDBC 실행80회/SELECT50회, 불일치0. 테스트는 실제 EXPLAIN ANALYZE BUFFERS JSON과 측정값을 출력한다. 작은 로컬 부하이며 운영 TPS·수용 인원을 의미하지 않는다. 저널 Worker의 수신→commit·반복 실패 측정은 risk-recovery-integration.md를 참고한다.

## 운영 검토 / 재실행

ops/inspect-ledger.sql은 계정별 최신 결과·검사 시각·원래 hold 증거를 읽는다. 원인을 조사하고 별도 승인된 복구를 한 뒤 Worker의 새로운 검사를 기다린다. ops/review-ledger-hold.sql은 최신 검사에 실패 항목이 없고 hold 이후5분 내 검사이며 계정이 ACTIVE인 경우에만 근거 식별자(8자 이상)를 남겨 해당 hold 하나를 해제한다. 실행 결과 UPDATE 0은 조건 불충족이므로 강제로 우회하지 않는다. 복구 중에는 다른 수동 DB 변경을 중단하고 snapshot과 실제 원장을 검토해야 한다. 이 스크립트는 잔액·주문·Fill을 수정하지 않는다. 임의 돈 보정·가짜 Fill 생성 도구는 제공하지 않는다.

V20은 진단/scan cursor 테이블만 추가한다. 사용 이력이 없는 Guest에 허용된 기존 만료 정리에서만 disposable 최신 진단도 함께 삭제되며, 금융·회차 원장과 불일치 hold 이력은 삭제하지 않는다. 신규 의존성·Secret·필수 환경변수는 없다. 운영 금융 데이터에 이번 migration을 적용하지 않았다.

V18→V19→V20 순서로 배포 전 백업과 구버전 앱/Worker 중지가 필요하다. 기존 DB/Flyway 분리 계정과 trading schema 정책을 유지한다. Java17/Docker에서 trading-server/gradlew.bat -p trading-server clean build로 재실행한다. trading.reconciliation.enabled=false는 격리 테스트용이며 정상 운영은 기본true다.

## Frontend 계약

신규 Admin API나 Frontend 수정은 없다. 기존 GET /api/v1/trading/account/recovery의 REVIEW_REQUIRED, holds[].reason=LEDGER_MISMATCH를 표시한다. 내부 snapshot/SQL은 일반 API에 노출하지 않는다. ACCOUNT_RECOVERY_HELD를 무한 주문 재시도하지 않고 운영 검토가 필요함을 안내한다. CLEAR/PENDING, Idempotency-Key, outcome=UNKNOWN/NOT_ACCEPTED 계약은 가격 복구 Integration Note와 같다.

방향별 레버리지와 성과 API의 요청·예제·필수 side 변경은 각각 side-leverage-integration.md, symbol-performance-integration.md를 따른다. Content/인증 계약 변경은 없다. 기존 문서의 공유 레버리지·성과 후순위 설명은 이번 사용자 확정 제품 정책으로 대체되었으며 루트 문서는 수정하지 않았다.
