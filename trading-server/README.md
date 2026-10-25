# Trading Server

Binance WebSocket 시세를 사용하는 **USDT 선물 모의투자** 백엔드다. 실제 거래소 주문이나 실자금 출금 기능은 없으며, 금융 원장의 원본은 PostgreSQL `trading` Schema다.

## 기술과 주요 기능

- Java 17, Spring Boot 3.5.16, Gradle, Spring Security, JPA/Flyway, PostgreSQL, Redis, WebSocket.
- Guest/회원 계정, 서버 가격, 시장가·지정가, 미체결 취소, LONG/SHORT Hedge, Isolated Margin, 부분 청산·강제청산, 주문·체결·포지션 이력, 회원 회차 및 Guest 재도전.
- 레버리지 범위 **1~100배**, 기본 **10배**. 설정은 **계정·종목·LONG/SHORT 방향별 독립**이다. Backend에 이미 반영된 계약이며 Frontend 연결 상태는 따로 검증한다.
- 수수료·격리 담보·위험 계산·체결 가격은 서버가 결정한다. 최신 정책·수치의 권위 있는 근거는 `TradingMath`, 실행 서비스 및 DTO다.

## 인증과 데이터

- Guest: `POST /api/v1/trading/accounts/guest`로 10,000 USDT 체험 계정과 7일 opaque Bearer Credential 발급. JWT 아님.
- 회원: Content가 발급한 RS256 JWT를 공개키로 검증하며, `POST /api/v1/trading/accounts/member`로 본인 거래 계정을 명시적으로 열거나 조회한다. 최초 회차는 10,000 USDT다.
- Guest 재도전: 같은 계정 ID/credential을 유지하고 모의 자금을 재설정, 과거 금융 이력 보존.
- 회원 재시작: 새로운 10,000 USDT 회차 생성. 24시간 제한, 기존 회차 읽기 전용 이력 보존. Guest 금융 이력 자동 병합 없음.
- Content DB 테이블 직접 접근 금지. 주요 금융 기록은 PostgreSQL에 보존하며 Redis는 가격·Stream·캐시에 사용한다.

## 주요 API (요약)

| 용도 | 메서드·경로 |
|---|---|
| Guest 계정 발급 | `POST /api/v1/trading/accounts/guest` |
| 회원 계정 열기 | `POST /api/v1/trading/accounts/member` |
| 지갑·포지션·계정 요약 | `GET /api/v1/trading/account/wallet`, `/positions`, `/summary` |
| 방향별 레버리지 | `GET /api/v1/trading/account/symbols/{symbolId}/leverage?side=LONG`, PUT 동일 경로 본문 `{side,leverage}` |
| 종목별 성과 | `GET /api/v1/trading/account/performance/symbols` |
| 계정 복구 상태 | `GET /api/v1/trading/account/recovery` |
| 글로벌 처리 상태 | `GET /api/v1/trading/status` |
| 주문 예상 견적 | `POST /api/v1/trading/account/orders/quote` |
| 주문 생성·조회·취소 | `POST/GET /api/v1/trading/account/orders`, `POST /api/v1/trading/account/orders/{orderId}/cancel` |
| 포지션 청산 | `POST /api/v1/trading/account/positions/{positionId}/close` |
| 예약 청산 | `POST /api/v1/trading/account/positions/{positionId}/close-orders` |
| 체결·종료 포지션 이력 | `GET /api/v1/trading/account/fills`, `/positions/history` |
| Guest 재도전 | `POST /api/v1/trading/account/retry` |
| 회원 재시작·회차 목록 | `POST /api/v1/trading/account/restart`, `GET /api/v1/trading/account/rounds` |
| 현재 회차·회차별 원장 | `GET /api/v1/trading/account/rounds/current`, `/rounds/{roundId}`, `/rounds/{roundId}/orders`, `/fills`, `/positions` |

세부 권한·요청·응답·오류는 현재 Controller/DTO와 개발용 Runtime OpenAPI(`/v3/api-docs`)가 기준이다. 신규 주문·청산·재시작 등은 Idempotency-Key 계약을 준수한다.

## 거래 엔진과 정합성

- Binance 수신 → 서버 검증·PostgreSQL 가격 journal/해당 계정 작업 기록 → DurableRiskWorker의 계정별 순서 처리 → 금융 원장과 작업 DONE 커밋. Redis Snapshot/Stream/PubSub는 시세 공유·전송에 사용한다.
- 계정 단위 Row Lock, DB Transaction, 멱등성, 예약 증거금, 재처리 방지 및 실패 롤백으로 정합성을 보호한다.
- Worker 재시작은 영속 작업을 재개한다. 미수신 구간은 복원했다고 가정하지 않고 hold/검토 상태로 보존한다. 글로벌 `ENGINE_RECOVERING`, 계정 대기 `ACCOUNT_RISK_PENDING`, 검토 필요 `ACCOUNT_RECOVERY_HELD`, 현재 시세 미가용 `PRICE_NOT_FRESH`를 구분한다.
- 계정 recovery 상태는 CLEAR/PENDING/REVIEW_REQUIRED다. 명확한 업무 거절 outcome=NOT_ACCEPTED와 예상치 못한500/응답 유실의 UNKNOWN을 구분해 동일 키 결과 확인을 지원한다.
- 원장 대사는 지갑·예약·포지션·Fill·회차/자본조정의 일치를 검사한다. 불일치는 LEDGER_MISMATCH hold로 남기며 돈을 자동 보정하지 않는다.
- 현재 실행 설계는 단일 노드 중심이다. 다중 노드 Worker 소유권·조정은 후속 Scale-Out 과제다.

## 실행·검증

루트 `docker-compose.yml`이 제공하는 로컬 PostgreSQL·Redis를 먼저 실행한다. 공통 환경변수 예시는 루트 `.env.example`에 있으며 Spring Boot는 `.env`를 자동 로드하지 않는다.

- 로컬 기본 API 포트 `8081`. 로컬 DB 접속, Redis 및 선택적 회원 JWT 공개키 환경변수 구성이 필요하다.
- 주요 환경변수: `YOGIMANGCHI_DB_USERNAME/PASSWORD/PORT`, `YOGIMANGCHI_REDIS_HOST/PORT`, `TRADING_SERVER_PORT`, `TRADING_MEMBER_AUTH_ENABLED`, `TRADING_JWT_PUBLIC_KEY_PATH`, `YOGIMANGCHI_JWT_ISSUER`, 허용 Origin 설정.

```bash
# trading-server/ 내부, Java 17 및 환경변수 설정 후
./gradlew bootRun
./gradlew clean build
```

테스트 중 일부는 Docker/Testcontainers 환경이 필요하다. 동시 체결·취소·청산·회수·롤백·Redis Stream 복구 테스트가 있으며, 과거 PR 기록과 현재 재실행 결과를 구분한다. Swagger/OpenAPI는 개발 환경에서만 노출하고 운영에서는 비활성화한다.

작업 경계·금융 불변조건은 [`AGENTS.md`](AGENTS.md), [`../AGENTS.md`](../AGENTS.md)를 따른다. 상세 기존 이력은 `docs/` 아래에 보존하고, 사용자의 명시적 요청 없이는 MD를 자동 갱신하지 않는다.

## 상세 계약·이관 자료

- [방향별 레버리지 / V18](docs/side-leverage-integration.md)
- [종목별 성과](docs/symbol-performance-integration.md)
- [영속 가격 위험 작업·복구 / V19](docs/risk-recovery-integration.md)
- [원장 대사 / V20](docs/ledger-reconciliation-integration.md)
- [회원 회차·재시작 / V17](docs/member-rounds.md)
- [Isolated 이관](docs/isolated-margin-cutover.md)

V18~20 이관 시 백업과 구버전 Trading 앱/worker 중지, Flyway 버전 순서 및 Frontend side 계약 확인이 필요하다. 기존 migration을 수정하거나 공유 DB를 초기화하지 않는다.

2026-10-25 develop `0e47eac` 검증에서는 자동 테스트600개가 통과했으나 실제 누적 위험 작업 조회가 약2.93초 걸리고 정상 계정의 대기가 증가해 주문·청산이 차단됐다. 다음 작업은 이 적체 해결과 실제 회원 거래 전 과정 검증이다. 이 기록은 과거 관측이며 수정 완료 여부는 새 테스트·PR에서 확인한다.
