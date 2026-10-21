# Hedge + Isolated 전환 계약과 실행 게이트

상태: **Phase 1 병합 / Phase 2 구현·검증 / 배포 게이트 유지**. 2026-10-20 사용자가 실제 Mark/gap adjustment/자동 청산0.05%/기존 margin 보존/위험 legacy 보류 권장안을 확정했다. 신규 실행 엔진은 Isolated Only이며 전체 V1 이식은 미완료다. 현재 금융/fee/quote 계약의 원본은 Runtime OpenAPI와 Trading README다.

## 확인한 현재 원장

V2 `2abaf45`의 Position에는 `margin`, `entry_notional`, `reserved_close_quantity`가 있고 Wallet에는 `balance`, `used_margin`, `reserved_margin`, `realized_pnl`이 있다. margin은 각 Position에 수치로 배정돼 있지만 손실 한도·청산 판단은 계정 전체다.

2026-10-20 로컬 PostgreSQL을 READ ONLY로 조회한 결과: Flyway V10, 계정20, OPEN Position6, PENDING Order0. Wallet 사용/예약 합계 불일치0, `balance < used_margin + reserved_margin`0. 이것은 해당 시점의 구조적 집계이며 운영 DB·전환 시점의 가격/담보 안전성·migration 성공을 보장하지 않는다. 사용자 포지션·주문·Wallet을 변경하거나 초기화하지 않았다.

## 재사용과 교체

유지: Account DB lock, 동일 Transaction의 Order/Fill/Position/Wallet 변경, idempotency key/fingerprint, exact remaining entry basis, Hedge unique constraint, 종목별 공유 1~100배, Redis stream/checkpoint/replay/gate, authoritative domain Mark와 freshness.

교체: `AccountValuation.Value.atRisk()` 기반 전 계정 청산, `LiquidationPriceEstimator`의 Cross 조건부 탐색, 계정 미실현 손실로 다른 포지션까지 담보를 조달하는 가용잔고 규칙, `marginMode="CROSS"` 계약. 계정 합산 평가액은 정보용으로 남길 수 있지만 개별 격리 청산 근거로 사용하지 않는다.

## Phase 1 금융 항등식과 Phase 2 확장

`B`: 현재 Wallet balance(격리 담보를 포함하는 장부 현금), `M_i`: Position i의 격리 담보, `R`: Pending OPEN 담보+예상 fee를 포함하는 예약 현금, `U_i(P)`: exact basis로 계산한 gross 미실현 손익.

- free cash = `B - ΣM_i - R`. 타 포지션의 미실현 수익을 새 주문 재원으로 쓰지 않는다.
- position equity = `M_i + U_i(P)`.
- gross maintenance = `ceil18(P * Q_i * 0.005)` 를 사용한다. 기존 V2 유지증거금률을 보존한다. V1에는 이 MM 계산이 없으므로 동일 공식이라고 주장하지 않는다.
- risk = `position equity <= maintenance + ceil18(Mark * quantity * 0.0005)`를 사용한다. 실제 LIQUIDATE에도 같은 fee 계산을 적용한다. **fee를 임계값 보정에 넣는 것과 실제 fee 차감은 별개**다.
- OPEN: exact basis 증가분에 대한 `ceil18(basis/leverage)` 담보를 추가 배정하고 실제 체결 명목금액의 fee를 free cash에서 한 번 차감한다.
- partial CLOSE: 기존 `releasedMargin`(DOWN18, 전량은 잔액 전부)와 정확한 비례 basis를 재사용한다. 잔여 margin/basis/quantity/예약 수량을 한 Transaction에서 갱신한다.
- leverage 변경: 각 방향 margin과 Pending OPEN 예약을 함께 재계산한다. free cash가 부족하거나 새 격리 equity가 위험 구간이면 전체 변경을 rollback한다. entry basis/quantity/gross realized는 바꾸지 않는다.
- 강제청산: 위험한 Position만 종료한다. 해당 Position의 Pending CLOSE 예약만 해제·종료하며 다른 Position·무관 Pending 주문을 계정 단위로 일괄 취소하지 않는다.
- 시세 판단: 해당 Position의 fresh Mark가 필수다. 다른 종목의 unavailable 가격 때문에 이 Position의 정당한 강제청산을 무조건 건너뛰지 않는다. 계정 합산 평가는 별도로 unavailable일 수 있다.

새 원장 필드는 실제 정책을 표현할 때만 추가한다. 기존 Order/Fill의 `margin_mode`, gross fee/settlement adjustment 등 과거 사실과 신규 사실을 구분할 최소 메타데이터가 필요하다. 과거 Cross Fill을 Isolated Fill이라고 재분류하지 않는다. 기존 Flyway V1~V10 파일을 고치지 않는다.

## 먼저 결정할 실제 Mark 갭 손실 정책

V1 `FuturesLiquidationExecutionService`는 저장 청산가에서 정산하며 반환액이 음수면 지갑에 넣지 않는다. V2는 실제 Mark 체결 이력을 남긴다. 가격 gap에서 이 둘은 동일한 결과가 아니다.

예: LONG 1개, entry100, margin10. 실제 첫 유효 Mark80이면 gross PnL=-20이다. Isolated의 최대 담보 손실을10으로 제한하려면 나머지10을 원장에서 설명해야 한다. fee가 있다면 부족분도 따로 포함한다.

권장안: 실제 Fill price80/gross PnL-20을 그대로 보존하고 `isolated shortfall adjustment=10(+미충당 fee)`를 별도 영속 기록한다. 사용자 Wallet 반영은 담보 손실 한도까지만 한다. **허위 체결가90, gross PnL의 조용한 덮어쓰기, 반대편/미사용 Wallet에서 자동 보전은 하지 않는다.** 이 adjustment는 가상 플랫폼이 부담한 초과 손실이며 사용자 수익이나 입금이 아니다. Wallet/PnL 조회는 gross PnL·fee·adjustment·net 변화를 분리해야 한다.

이 정책은 V1의 암묵적 cap을 V2에서 추적 가능한 원장으로 바꾸는 제품상 결정이며 **사용자가 권장안으로 확정했다.** 대안으로 청산가를 체결가로 사용하는 V1 방식은 실제 Mark 기반 체결 요구와 충돌하므로 사용하지 않는다. 이 정책 승인은 실제6개 legacy Position을 임의 청산하거나 기존 DB를 즉시 변경하라는 승인이 아니다.

수수료: MARKET OPEN/CLOSE0.05%, LIMIT 모의 trigger 체결0.03%, 자동 청산0.05%를 구분 기록한다. 별도 penalty rate를 도입하지 않는다. 강제청산 담보가 fee까지 충당하지 못하면 위 adjustment를 적용한다. V12 이전 Pending의0% 접수 계약·예약은 소급 변경하지 않는다. 새 OPEN 최소10 USDT이며 과거 접수 계약/소액 CLOSE와 구분한다. `/api/v1/trading/account/orders/quote`는 fee 포함 비용·비율 수량을 제공하며 예약을 만들지 않는다. Phase 1/2와 호환 Frontend를 통합 release gate로 관리한다.

## 기존 Cross Position 전환

1. 승인된 유지보수 창에서 모든 기존 Trading instance/worker와 금융 요청을 중지한다. 혼합 버전 실행을 금지한다.
2. PostgreSQL의 일관된 backup과 실제 restore 시험, 애플리케이션 artifact/config 및 원장 합계 snapshot을 확보한다. Redis는 금융 backup 대체재가 아니다.
3. [읽기 전용 검사](../ops/isolated-margin-preflight.sql)를 실행한다. 불일치가 하나라도 있으면 중단한다. 검사 성공도 전환 승인 또는 가격 위험 검증 성공은 아니다.
4. V11에서 원장 테이블을 잠그고 구조적 검사 조건을 다시 확인한다. 시세 검증이 필요한 기존 OPEN 계정은 PENDING으로 영속 보류한다. 조회와 적용 사이 변경 가능성을 무시하지 않는다.
5. 기존 `Position.margin`을 **동일 금액 그대로** 격리 담보로 전환하는 안을 권장한다. Wallet 총액/실현손익/과거 Order·Fill·Position 참조를 바꾸거나 미실현 수익을 임의 분배하지 않는다. 그 의미 변경은 사용자 승인을 받았으며 전환 시 담보/Mark/시각을 각 legacy Position에 영속 기록한다.
6. 신규 Trigger가 AccountLock 아래 모든 기존 노출의 fresh Mark로 안전성을 재검사한다. 이 검사가 끝나기 전 계정의 주문/종료/레버리지 쓰기는 MARGIN_MIGRATION_REQUIRED로 차단한다. 기존 Cross에서는 안전했으나 Isolated로는 이미 위험한 Position이 존재할 수 있다. **자동 재분배·임의 강제종료로 처리하지 않는다.** 대상 계정은 REVIEW_REQUIRED로 영속 보류하고 개별 수동 정리/처리 정책을 승인받는다. 가격이 회복돼도 이 보류를 자동 해제하지 않는다. 데이터 복원 없이 옛 Cross writer로 돌아가는 것도 금지한다.
7. 테스트 DB에서 기존 상태(양방향/여러 종목/부분청산/예약/실현손익)를 재현하여 동일 총액·원장 link·반복 migration/no-op·실패 rollback을 검증한다.
8. 모든 gate 통과 후 신버전만 재개한다. 새로운 Isolated 거래가 기록된 뒤에는 old artifact만 재기동하는 rollback을 허용하지 않고 정지→사전 backup 복구 또는 검증된 forward fix를 사용한다.

현재6개 OPEN Position의 삭제, 자동 청산, Wallet reset은 승인되지 않았으며 실행하지 않았다. V11은 테스트 DB에서만 검증하며 실제 사용자 DB에는 적용하지 않았다.

## Frontend 호환 전환

실제 V2 `frontend/src/features/trading/api/leverage-contract.ts:14`는 `marginMode !== "CROSS"`이면 응답을 거절한다. Backend만 먼저 ISOLATED 응답으로 배포하면 레버리지 조회가 깨진다. 서버가 실제 Isolated인데 CROSS라고 거짓 응답하는 호환책은 금지한다.

권장 순서:

1. Frontend Work에서 CROSS/ISOLATED를 정확히 파싱하고 서버가 반환한 모드/예상가·status·asOf를 표시하도록 먼저 호환 릴리스를 준비한다. 서버 금융식을 UI에 복제하지 않는다.
2. Backend 격리/수수료 PR을 테스트하되 금융 의미 변경 배포는 아래 승인 전 보류한다. 두 margin mode를 사용자가 선택하는 기능은 만들지 않는다.
3. 호환 Frontend release→거래 정지/DB 전환→Isolated Backend release→실제 양방향/청산 smoke test. 기존 Cross 예상가를 격리 예상가로 표시하지 않는다.

Phase 1 API: 기존 `/api/v1/trading/account/{summary,positions,wallet}`와 `/symbols/{id}/leverage`를 재사용하되 응답 mode/status의 정확한 계약은 Runtime OpenAPI를 따른다. `liquidationPrice` decimal string/null과 status/asOf를 유지하고 Position의 `marginMode=ISOLATED`, `openedMarginMode`를 명시한다. LONG은 ESTIMATED_DOWNWARD, SHORT는 ESTIMATED_UPWARD다. 시세가 없으면 PRICE_UNAVAILABLE, legacy 보류는 MARGIN_MIGRATION_REQUIRED다. Wallet/Leverage에는 marginTransitionStatus=COMPLETE/PENDING/REVIEW_REQUIRED를 제공한다. legacy는 marginMode=LEGACY_CROSS이며 Cross 신규 거래는 불가능하다. Order Request의 Idempotency-Key, 인증 계정 결정, ProblemDetail.code는 보존한다. fee를 반영한 서버 주문 가능 수량/비용 계약도 Phase 2에서 제공하여100% 비율 계산의 UI 복제를 줄인다.

**BLOCKED BY FRONTEND COORDINATION**: Frontend 파일을 이 Backend Work에서 수정하지 않는다. 필요한 대상은 `api/leverage-contract.ts`, `api/account.ts`, `components/account-tables.tsx`, 주문 사이징/비용/청산 표시 테스트다. 다른 Work에 메시지도 별도 지시 없이 보내지 않았다.

## 후속 구현의 검증 게이트

- LONG/SHORT, Hedge, 순노출0, 다중 종목에서도 독립 담보·독립 liquidation.
- 추가진입·부분/전량 CLOSE·예약0.7+시장가0.5 초과 차단·leverage1/10/14/100.
- 임계값±1ULP와 동일 실제 engine arithmetic; extreme price/quantity/fee rounding.
- 위험 Position의 정확한 취소 범위, 반대편 보존, gap shortfall·gross/fee/net 항등식.
- 주문/지정가/취소/레버리지/강제청산 경합, 중복 event·중복 settlement 방지.
- PostgreSQL legacy migration/retry/rollback·기존 이력·Redis 장애/stream replay/cursor.
- API 인증/권한·stale null·OpenAPI·Frontend 호환 릴리스 확인.

## 승인 상태와 별도 실행 게이트

1. **승인됨**: 실제 Mark Fill + 별도 영속 shortfall adjustment + 자동 청산0.05% 정책.
2. **승인됨**: 기존 Cross 담보 금액 보존 전환, 이미 격리 위험인 legacy Position은 자동 종료하지 않고 전환 보류. 대상의 개별 처리에는 별도 승인이 필요하다.
3. **배포 게이트**: 별도 Frontend Work의 호환 release와 유지보수 배포 순서. Frontend 수정 승인은 요청하거나 받지 않았다.
4. **별도 범위 승인됨(2026-10-21)**: Phase 4의 `content-server/**` 신규 생성과 필요한 루트 README/AGENTS/docker-compose.yml/.env.example 갱신. Content 인증 계약→Trading JWT 검증 순서다. Frontend 수정·실제 Secret 저장·Guest 금융 이력 자동 병합은 승인 범위에 포함하지 않는다.
