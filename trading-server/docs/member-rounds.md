# 회원 모의투자 회차·재시작 계약

## 구조와 기존 코드 재사용

TradingAccount는 계속 memberId당 하나이며 Wallet도 계정당 하나다. 매번 새 금융 계정을 만들지 않는다.
기존 AccountLock(2초 lock timeout), Advisory provisioning lock, Order/Position 관리상 종료, Wallet 노출 해제와
TradingEvents 영속화, 서버 Mark 기반 가격/체결·청산 경로를 유지한다. 신규 외부 의존성은 없다.

member_trading_round: id/accountId/memberId/roundNumber/status/funding/initialBalance/startedAt/endedAt/endReason,
시작 누적 PnL·수수료·조정액 기준값, finalWallet JSONB. 계정별 ACTIVE 하나, 번호 유일, 종료 스냅샷 불변.
member_restart: 계정별 requestKey 유일, 이전/새 회차 FK, balanceBefore/capitalAdjustment, 취소/종료 개수, 성공 DB 시각.
자금 조정액은10000-beforeBalance이며 체결 손익/수수료에 합산하지 않는다.
member_round_retirement: 관리상 종료 직전 positionId/roundId/잔여 수량/정확한 진입 원가/해제 담보 보존.
Order/Fill/Position/TradingEvent round_id는 immutable FK이며 날짜 비교로 추측하지 않는다.
DB insert trigger가 모든 기존 HTTP/Engine 경로에 회원의 ACTIVE 회차를 부여한다. Guest는NULL이다.
Fill/Event는 실제 Order 회차를 상속한다. 완료 회차 Order 신규 체결/신규 Fill과 회차 ID 재할당은 DB에서도 거절한다.

## 최초 지급·장애 복구

신규 MemberAccounts.open은 member provisioning Advisory lock 안에서 계정/10000USDT Wallet/INITIAL_GRANT1회차를 함께 생성한다.
회원 계정 생성 공개 API는 본인 JWT sub만 사용한다. Content 영속 outbox 전달도 같은 경로다.
`POST /internal/v1/members/{memberId}/trading-account`는 audience=trading-internal,token_use=member_provisioning,
60초 이하 Content 서명 토큰과 path/sub 일치가 필요하다.204는 커밋 완료 확인이다.
일반 Access, Guest, 탈퇴 목적 토큰으로 계정을 만들지 못하고 provisioning 목적 토큰으로 탈퇴하지 못한다.
실패/재시작/응답 유실/중복/동시 전달에도 기존 Wallet을 다시 지급하지 않는다. 탈퇴 tombstone은 재생성을 차단한다.

## 재시작·원장·동시성

회원 JWT+`POST /api/v1/trading/account/restart`+Idempotency-Key8~100 영숫자/하이픈/밑줄.
AccountLock 아래 기존 성공 키 확인 → DB clock와 마지막 성공+24시간 확인 → 현재 회차 미체결 OPEN/CLOSE 취소 및 예약 해제 →
잔여 수량·원가·담보 스냅샷 → OPEN 관리상 CLOSED/MEMBER_RESTART → 노출/예약 합계 검증 → 종료 Wallet 스냅샷 →
balance10000·계정 ACTIVE/Isolated → 새 회차 → 요청/자금 조정액 저장이 하나의 Transaction이다.
신규 Fill/PnL/fee/강제청산을 만들지 않으며 lifetime Wallet 합계를 유지한다. 오류면 취소부터 새 회차까지 모두 rollback한다.
성공 응답 roundId/roundNumber/balance/restartedAt/nextAvailableAt/canceledOrderCount/closedPositionCount를 제공한다.
같은 키는 원래 응답을 반환한다. 다른 키는 DB 기준24시간 내429와 nextAvailableAt이다. 가입/최초 회차는 제한 횟수에 포함하지 않는다.
회원 ID·프로필·OAuth·팔로우는 변경하지 않는다. Guest retry는 기존 정책 그대로이며 이 API는 Guest403이다.

모든 주문·취소·Worker 체결·청산·Wallet 조회·회원 탈퇴는 같은 AccountLock 순서를 따른다.
탈퇴가 먼저 잠금을 확정하면 재시작/금융 요청은 차단한다. 재시작이 먼저면 그 완료 후 탈퇴가 새 회차까지 안전 종료한다.
재시작 전 체결이 먼저 커밋한 경우 그 Fill은 이전 회차에 유지한다. 재시작 후 취소 주문은 다시 체결되지 않는다.
지연된 이전 회차 Mark는 새 회차 청산에 사용하지 않고 신규 주문은 자신의 생성 시각 이후 이벤트만 처리한다.
이 조건은 기존 정상적인 미커밋 주문과 가격 crossing 대기를 건너뛰도록 바꾸지 않는다.
기존 pending/open 상한·정상 주문 비용·격리 정합성 검증은 유지한다.

## 조회·Frontend 통합

모든 경로는 `/api/v1/trading/account` 하위다. 본인 JWT/Trading 계정 소유권을 검증하고 타인/이전 회원의 roundId는404다.

| 경로 | 의미 |
|---|---|
| GET /rounds/current | 현재 Round와 currentAccount 실시간 요약, 회차 realizedPnl/feesPaid/settlementAdjustment, restartAvailable/nextAvailableAt |
| GET /rounds | cursorId(배타적)/limit1~100(기본20), content/nextCursorId |
| GET /rounds/{roundId} | 같은 Summary, 완료 회차 currentAccount=null/finalWallet 영속 스냅샷 |
| GET /rounds/{roundId}/orders | 명시적 roundId의 주문, 취소 사유 포함 |
| GET /rounds/{roundId}/fills | 명시적 roundId의 실제 체결·PnL·fee·격리 조정액 |
| GET /rounds/{roundId}/positions | 포지션 lifecycle, closeReason/retiredQuantity/retiredEntryNotional/retiredMargin 포함 |

원장 API도 ID cursorId와limit1~100/nextCursorId를 사용하며 금액·수량은 문자열, 시각은 ISO8601이다.
과거 회차는 읽기 전용이며 현재 시세로 재계산하지 않는다. 관리상 종료의 exitPrice=null을 실제0손익 체결로 표시하지 않는다.
현재 Wallet의 realizedPnl/feesPaid/settlementAdjustment는 lifetime 값이다. Summary 바깥의 동명 회차 필드는 시작 baseline을 뺀 값이다.
새 주문 API에는 회차 선택이 없고 항상 현재 ACTIVE 회차에 속한다.
개인 HTTP/WS 이벤트의 roundId/roundNumber로 이전 회차 이벤트를 구분하고 eventId로 중복 제거한다.
재시작 응답 후 current round/Wallet/Position/Pending Order를 다시 조회한다. 과거 round 이벤트로 현재 화면을 덮어쓰지 않는다.
아직 실제 체결이 없는 새 회차는 재시작 자체의 거래 이벤트를 합성하지 않는다. 다른 탭도 current API를 다시 확인해야 한다.
전체 OAuth/Frontend/Trading 사용자 시나리오는 두 Work가 완료되어 develop에 합쳐진 뒤 별도 검증한다.

## V17 배포·기존 데이터

새 Flyway `V17__member_rounds.sql`. 이전 migration을 수정하지 않는다. 실제 사용자 DB에는 적용하지 않았다.
기존 회원 계정의 pre-round 생애주기가 하나이므로 그 계정의 기존 Order/Fill/Position/Event를 한 초기 LEGACY_UNVERIFIED 회차로 연결한다.
회원 Wallet이 누락된 기존 DB는 migration을 실패시켜 검토 없이 회차를 누락하지 않는다. initialBalance=NULL은 최초 지급을 추측하지 않았다는 뜻이다. Wallet/체결가/기존 PnL/수수료를 바꾸거나0잔액만 보고 일괄 지급하지 않는다.
기존 탈퇴 계정은 완료 회차로, ACTIVE/BANKRUPT는 활성 회차로 이관한다. 과거 관리상 종료의 미기록 잔여 원가를 새로 만들어내지 않는다.
이전 DB에 별도 비공식 회원 reset 생애주기가 있다면 이 전제를 확인하고 migration을 적용하지 말고 검토해야 한다.
운영 적용 전 아래 읽기 전용 사전 점검, 백업 및 복구 리허설, 쓰기 중지/배포 창이 필요하다.
Trigger/FK/index/이력 backfill은 대량 데이터에서 잠금/작업 시간이 발생하므로 복제된 DB로 실행 시간·용량을 측정한다.
신규 DB 함수는 migration 당시 자신의 schema search_path를 고정한다. DB role에 해당 함수 실행/테이블 쓰기 권한이 있는지 검토한다.
Trading V17/API를 먼저 배포하고 Content V4/생성 전달을 활성화한다. 구버전 binary로 돌아가도 round/grant 불변식이 유지되는지 검토한다.
특히 신규 배포 이후 구버전 member 생성 코드로 신규0잔액 계정을 만들지 않도록 writer를 동시에 중지한다.

```sql
-- V16 기준 사전 점검: 사용자 DB에서 읽기만 한다.
SELECT a.id,a.member_id,a.status,w.balance,
 (SELECT count(*) FROM trading.trading_order o WHERE o.account_id=a.id) order_count,
 (SELECT count(*) FROM trading.position p WHERE p.account_id=a.id) position_count
FROM trading.trading_account a LEFT JOIN trading.wallet w ON w.account_id=a.id
WHERE NOT a.guest_account ORDER BY a.id;
SELECT a.id FROM trading.trading_account a LEFT JOIN trading.wallet w ON w.account_id=a.id WHERE w.account_id IS NULL;
SELECT f.id FROM trading.fill f LEFT JOIN trading.trading_order o ON o.id=f.order_id WHERE o.id IS NULL;
```

자금 이관 후보는 단순0잔액이 아니라 지급 기록·과거 거래·운영 이력을 검토해 별도 승인한다. 이번 API는 기존 자금 이관/일괄 grant 도구가 아니다.
