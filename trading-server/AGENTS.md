# Yogimangchi V2 Trading Server Instructions

이 문서는 Yogimangchi V2의 `trading-server`에서 반드시 따라야 하는 Trading 전용 개발 규칙을 정의한다.

작업을 시작하기 전에 다음 문서를 함께 따른다.

1. 루트 `README.md`
2. 루트 `AGENTS.md`
3. 현재 `trading-server/AGENTS.md`

루트 규칙과 이 문서의 규칙이 충돌하는 경우 `trading-server` 내부에서는 더 구체적인 이 문서의 규칙을 우선한다.

Trading Server는 Yogimangchi V2에서 특히 데이터 정합성, 동시성, 가격 신뢰성 및 장애 복구가 중요한 영역이다.

단순히 정상적인 상황에서 동작하는 구현이 아니라 다음을 우선한다.

- 중복 주문 및 중복 체결 방지
- Wallet 정합성
- Position 정합성
- Transaction 원자성
- 동시 요청 안정성
- 체결 및 강제청산 누락 방지
- 장애 발생 후 복구 가능성
- 대량 작업 안정성
- 읽었을 때 업무 흐름을 이해할 수 있는 코드

불필요한 복잡성을 만들지는 않지만 위 조건을 만족하기 위해 필요한 복잡성을 제거하지 않는다.

---

## 작업 판단 기준

이 문서는 Trading의 제품·데이터 불변조건을 정의한다. 현재 구현 상태, 초기 Seed 목록, 실행·환경변수·로그 설정은 `README.md`와 현재 코드에서 확인한다.
요구사항을 만족하는 가장 단순하고 안정적인 구현을 선택한다. 기존 구조는 재사용하되 명확한 개선이 있다면 변경할 수 있다.
클래스, 자료구조, Lock, Scheduler, Query 기술은 실제 문제와 검증 결과를 기준으로 Agent가 선택한다.
필요한 의존성은 루트 정책에 따라 추가할 수 있으며, 선택 이유와 영향을 완료 보고한다. 미래 기능과 과도한 추상화를 선행 구현하지 않는다.

### Single-node complete, Multi-node ready

- 현재 한 대의 Trading Server와 PostgreSQL·Redis만으로 요청된 기능이 완전히 동작해야 한다.
- Trading 정합성은 영구 DB의 Transaction·동시성 제어·멱등성으로 보장하고, JVM 메모리에만 의존하지 않는다.
- 현재에도 필요한 공유 Market State·실시간 전달·이벤트 재처리 경계는 구현하여 향후 다중 서버에서도 핵심 Trading Domain을 재작성하지 않도록 한다.
- 여러 서버가 있어야 의미가 있는 Leader Election, Node Registry, 서버 간 Heartbeat 및 Ownership Coordinator는 선행 구현하지 않는다.
- 자연스럽게 드러나지 않는 미래 Coordination 경계에만 짧은 TODO를 남긴다. 구체적인 구현 방법은 현재 요구사항과 테스트를 기준으로 선택한다.

# 1. Trading Scope

Yogimangchi V2의 모의투자는 **USDT 기준 Futures Trading만 지원한다.**

지원:

- Guest Trading
- Competition Trading
- LONG
- SHORT
- Market Order
- Limit Order
- Leverage
- Wallet
- Position
- Margin
- Realized PnL
- Unrealized PnL
- Liquidation

Trading Account의 기본 자산 및 손익 계산 기준 화폐는 `USDT`로 통일한다.

지원하지 않는 기능:

- Spot Trading
- 실제 Binance 주문
- 실제 거래소 Matching Engine
- Binance Order Book 잔량을 소비하는 체결
- 실제 호가 잔량에 따른 부분체결
- Maker/Taker Matching Engine

Binance Order Book을 사용자에게 정보 목적으로 보여주는 기능은 향후 추가할 수 있다.

그러나 Binance Order Book의 잔량은 Yogimangchi 사용자의 주문 체결 여부 또는 체결 수량을 결정하는 기준으로 사용하지 않는다.

Yogimangchi는 실제 거래소가 아니라 **시장 가격을 기준으로 동작하는 가상 Futures Trading Engine**이다.

---

# 2. Supported Trading Symbols

- Futures 거래와 Wallet의 Quote Asset은 USDT다.
- 지원 종목은 PostgreSQL에서 관리한다. 초기 Seed를 Java Enum이나 Frontend 목록으로 고정하지 않는다.
- Frontend는 Trading Server API에서 Domain 기준 종목 정보를 받는다.
- 영구 식별자는 내부 `tradingSymbolId`다. Provider Symbol 변경으로 기존 이력의 정체성이 바뀌어서는 안 된다.
- Provider Symbol과 계약 단위는 명시적 Mapping으로 관리하고 Provider 연동 경계 밖으로 퍼뜨리지 않는다.
- 등록·Mapping 변경 시 공식 Futures metadata로 실제 계약, 단위, 상태 및 필요한 거래 규칙을 검증한다. 문자열 모양만 보고 단위를 추측하지 않는다.
- Provider 가격과 Domain 자산 한 단위 가격을 구분한다. 소비자에게 제공할 가격은 Domain 단위로 정규화한다.
- 새로운 Provider 종목을 자동 등록·활성화하지 않는다. 활성화는 서비스 운영 결정이다.
- 종목 비활성화는 신규 주문과 일반 거래 목록에서 제외하되 기존 이력을 유지한다.
- 기존 Pending Order / Open Position 처리는 명시적인 업무 정책이 필요하다. 비활성화와 상장폐지를 같게 취급하거나 기존 거래를 단순 삭제하지 않는다.
- Admin 인증·검증·비활성화 정책은 해당 기능을 구현할 때 결정하며, 현재 작업 범위를 넘어 구현하지 않는다.

---
# 3. Guest / Competition

Guest Trading과 Competition Trading을 서로 다른 Trading Engine으로 구현하지 않는다.

가능한 한 동일한 주문, 체결, Position, Wallet 및 Liquidation Engine을 사용한다.

차이는 Account와 Rule에서 표현한다.

예:

- 초기 자산
- 거래 가능 기간
- 거래 가능 Symbol
- 최대 Leverage
- 수수료
- Competition 종료 정책

Guest Trading Account와 Competition Trading Account의 Wallet, Position 및 주문 데이터는 서로 독립적으로 관리한다.

Competition마다 독립적인 Trading Account가 존재할 수 있다.

---

# 4. Server-authoritative Price

- Frontend 가격을 주문·체결·PnL·Liquidation의 신뢰 가능한 입력으로 사용하지 않는다. 가격의 신뢰 주체는 Trading Server다.
- 현재 authoritative price는 Binance USDⓈ-M Futures Mark Price다. Last Price 등 다른 가격 종류와 암묵적으로 혼용하지 않는다.
- 가격의 내부 종목 ID, Domain 단위, eventTime, receivedAt과 freshness를 함께 판단할 수 있어야 한다.
- 오래되거나 정상적인 시장 가격으로 판단할 수 없는 값으로 새로운 거래를 실행하지 않는다.
- 연결 상태와 개별 종목 가격의 freshness를 구분한다. 연결이 열렸다는 이유만으로 가격이 유효하다고 판단하지 않는다.
- 중복·역순 이벤트가 최신 가격을 되돌리거나 오래된 값을 fresh하게 만들지 않아야 한다.

---
# 5. Frontend Market Data Delivery

Browser는 Binance나 Redis에 직접 연결하지 않고 Trading Server에서 가격과 데이터 가용 상태를 받는다.
Binance 연결 수를 사용자 수에 비례하여 늘리지 않는다. 실제 Browser 전송은 해당 기능 요구가 있을 때 구현한다.
사용자에게 필요한 종목만 전송하는 것을 기본으로 하며, UI 전송 최적화가 Trading Engine의 가격 crossing 판단을 누락시켜서는 안 된다.
오래된 마지막 가격을 실시간 가격처럼 표시하지 않도록 timestamp와 상태를 함께 전달한다.
전송 빈도와 구독 관리의 구현 방법은 실제 요구·측정에 따라 선택한다.

---
# 6. Binance WebSocket Connection

Binance WebSocket Connection은 사용자 수와 독립적으로 Trading Server에서 중앙 관리한다.

지원 TradingSymbol마다 별도의 Binance Connection을 하나씩 만드는 방식을 기본값으로 사용하지 않는다.

가능한 경우 Binance가 제공하는 Combined Stream 또는 하나의 Connection에서 여러 TradingSymbol을 구독할 수 있는 방식을 우선 검토한다.

개념적인 구조:

```text id="combined-stream"
Binance WebSocket
        ↓
Combined TradingSymbol Streams
        ↓
TradingSymbol Event Router
        │
        ├─ BTC/USDT
        ├─ ETH/USDT
        ├─ XRP/USDT
        ├─ SOL/USDT
        └─ ...
```

Binance WebSocket 구현 시 다음 사항을 반드시 고려한다.

- Connection Lifecycle
- 연결 성공/실패 상태
- Ping / Pong
- 정상 Disconnect
- 비정상 Disconnect
- Provider가 정의한 Connection Lifetime
- Reconnect
- Exponential Backoff
- Jitter
- 기존 Subscription 복구
- 중복 Connection 방지
- Graceful Shutdown
- Message / Connection Rate Limit
- IP 제한 또는 IP Ban 가능성

연결 실패 시 즉시 무한 재접속하는 구조를 사용하지 않는다.

예:

```text id="reconnect"
Disconnect
    ↓
1차 Backoff
    ↓
Reconnect 실패
    ↓
더 긴 Backoff + Jitter
    ↓
Reconnect
```

재연결 과정에서 Subscribe 요청이나 Connection 생성이 폭주하여 Binance의 Rate Limit 또는 IP 제한을 스스로 유발하지 않도록 한다.

Binance의 Connection 수, Stream 수, Ping/Pong, Message Rate Limit, Connection Lifetime 및 IP 제한 정책은 구현 시점의 공식 문서를 기준으로 다시 확인한다.

Binance 장애 또는 Connection 실패가 Trading Server 전체 프로세스의 비정상 종료로 이어지지 않도록 한다.

---

# 7. Market Order

Market Order는 요청이 검증된 시점의 신뢰 가능한 서버 기준 가격으로 즉시 체결한다.

개념적인 흐름:

```text id="market-order"
Market Order Request
        ↓
Validation
        ↓
Account / Wallet / Margin 검증
        ↓
Order 생성
        ↓
Fill 생성
        ↓
Position 생성 또는 변경
        ↓
Wallet / Margin 변경
```

Market Order 역시 주문 이력이 남아야 한다.

Order를 생략하고 Position만 생성하는 방식으로 구현하지 않는다.

하나의 거래에서 함께 성공하거나 실패해야 하는 DB 상태 변경은 동일한 업무 Transaction 안에서 처리한다.

Transaction 중간에 실패하면 부분적인 체결 상태가 DB에 남지 않아야 한다.

---

# 8. Limit Order

Limit Order 요청 시 즉시 Position을 생성하지 않는다.

먼저 Pending Order를 생성한다.

기본 흐름:

```text id="limit-order"
Limit Order Request
        ↓
Validation
        ↓
Pending Order
        ↓
Price Trigger
        ↓
Order FILLED
        ↓
Fill 생성
        ↓
Position 생성 또는 변경
        ↓
Wallet / Margin 변경
```

가격 Trigger는 단순한 `currentPrice == orderPrice` Equality 비교에 의존하지 않는다.

예:

```text id="limit-cross"
Previous Price = 100
Current Price  = 98
Order Price    = 99
```

시장 가격 이벤트가 99를 정확히 전달하지 않았더라도 가격이 Trigger 가격을 통과했다면 조건을 놓쳐서는 안 된다.

LONG / SHORT 및 주문 방향에 따른 Trigger 조건을 명확하게 정의한다.

같은 Pending Order가 두 번 이상 체결되지 않도록 보장한다.

Order 체결은 멱등성을 고려한다.

---

# 9. Price Crossing

가격 이벤트가 모든 중간 가격을 전달한다고 가정하지 않는다.
Limit Price나 Liquidation Price를 정확히 찍지 않고 건너뛰어도 조건을 놓치지 않아야 한다.
이 불변조건을 만족하는 범위 판단·이벤트 보존 방식은 실제 Trigger 기능 구현 시 결정한다.
Latest Price 한 값만 보관하는 구조가 crossing 이력까지 보존한다고 가정하지 않는다.

---
# 10. Price Trigger Engine

영향받을 수 있는 후보를 탐색하고, 매 Tick마다 전체 Pending Order / Open Position을 읽는 비용이 발생하지 않도록 실제 조회 패턴과 규모를 검토한다.
탐색 자료구조와 Query 기술은 정확성·복구 가능성·복잡도·측정을 근거로 선택한다.
Redis나 Memory를 사용하더라도 영구 Order / Position의 원본은 PostgreSQL이며 보조 상태를 복구할 수 있어야 한다.

---
# 11. Scheduling

실시간 처리와 장애 복구·보정 작업의 책임을 구분한다.
주기 작업의 사용 여부, 실행 간격과 방식은 실제 누락·복구·만료 요구가 있을 때 결정한다.
무제한 중복 실행이나 반복적인 전체 조회로 정상 거래를 방해하지 않도록 검증한다.

---
# 12. Liquidation

Leverage를 사용하는 Position에는 Liquidation 조건이 존재한다.

LONG과 SHORT의 위험 조건을 명확하게 구분한다.

Liquidation 또한 정확한 가격 Equality 비교에 의존하지 않는다.

가격이 Liquidation Trigger를 통과한 경우에도 조건을 감지해야 한다.

Liquidation 발생 시 관련 데이터의 정합성을 보장한다.

예:

```text id="liquidation-data"
Position
Wallet
Margin
Realized PnL
Trading History
Liquidation History
```

같은 Position이 동시에 두 번 청산되지 않도록 보장한다.

강제청산과 사용자의 거래가 동시에 발생할 수 있다는 것을 항상 고려한다.

---

# 13. Wallet / Margin

하나의 Trading Account는 하나의 `USDT` Wallet을 사용한다.

하나의 Wallet을 기반으로 여러 TradingSymbol의 Position을 동시에 보유할 수 있다.

예:

```text id="wallet-example"
USDT Wallet

├─ BTC/USDT LONG
├─ ETH/USDT SHORT
└─ XRP/USDT LONG
```

각 Position은 서로 다른 Leverage를 사용할 수 있다.

여러 Position의 상태가 동일 Wallet의 사용 가능 자산, Margin 및 Account Risk에 영향을 줄 수 있음을 고려한다.

Wallet을 독립 Position들의 단순 잔액 저장소처럼 취급하지 않는다.

현재 구조는 Account 단위의 공유 USDT Wallet을 사용하는 Cross-Margin 성격을 가진다.

정확한 다음 계산 규칙은 관련 기능 구현 전에 명시적으로 정의하고 자동 테스트한다.

- Available Balance
- Used Margin
- Position Margin
- Realized PnL
- Unrealized PnL
- Liquidation 조건
- Leverage 영향

금융 계산 규칙을 Controller나 여러 Service에 분산시키지 않는다.

---

# 14. Decimal Precision

금액, 가격, 수량, Margin 및 PnL 계산에 `float` 또는 `double`을 사용하지 않는다.

정확한 Decimal 계산 방식을 사용한다.

Java에서는 기본적으로 `BigDecimal`을 사용한다.

다음 항목의 Scale 및 Rounding Policy를 명확하게 정의한다.

- Price
- Quantity
- Balance
- Margin
- PnL
- Fee

각 코드에서 임의의 Scale이나 RoundingMode를 사용하지 않는다.

Trading 전체에서 공통된 Precision Policy를 유지한다.

---

# 15. Concurrency

주문·취소·체결·청산이 동시에 발생하며 같은 대상에 여러 처리가 중복 도착할 수 있다고 가정한다.
Wallet / Position / Order 정합성과 중복 반영 방지를 보장하는 동시성 전략을 명시하고 테스트한다.
Lock 종류나 직렬화 방식은 업무 범위와 실제 경합을 기준으로 선택한다.
선택한 방식의 경합 범위, 교착·재시도·실패 동작을 검증하고 필요 없는 분산 동시성 시스템을 선행 도입하지 않는다.

---
# 16. Transaction

Trading Transaction은 단순한 Repository 호출 단위를 기준으로 하지 않는다.

하나의 실제 Trading 업무 단위를 기준으로 정의한다.

예:

```text id="transaction-example"
Order Execution

Order
  +
Fill
  +
Position
  +
Wallet
```

이 데이터들이 하나의 업무상 상태 변경이라면 전체가 성공하거나 전체가 실패해야 한다.

Transaction 내부에서 발생한 예외를 catch한 후 아무 처리 없이 삼켜 정상 Rollback을 방해하지 않는다.

외부 네트워크 호출을 DB Transaction 안에 장시간 포함하지 않는다.

Binance 및 다른 외부 시스템은 PostgreSQL Transaction의 Rollback 대상이 아니다.

---

# 17. Order / Position State

Trading 상태는 삭제보다 명시적인 상태 전이로 표현한다.

Order 상태 예:

```text id="order-status"
PENDING
FILLED
CANCELED
REJECTED
```

실제 필요한 상태만 추가한다.

미래의 가능성만을 이유로 상태를 미리 많이 만들지 않는다.

Order 상태 변경은 Setter가 아니라 의미 있는 Domain Method를 사용한다.

예:

```java id="order-methods"
order.fill(...);
order.cancel(...);
order.reject(...);
```

유효하지 않은 상태 전이를 허용하지 않는다.

예:

```text id="invalid-transition"
CANCELED → FILLED
FILLED → PENDING
```

같은 전이는 발생하지 않도록 Domain Rule을 구현한다.

Position 종료 역시 Row 삭제로 표현하지 않는다.

---

# 18. Trading History

Trading 이력 데이터는 추적 가능해야 한다.

주요 대상:

- Order
- Fill
- Position 변화
- Liquidation
- Wallet 변화가 필요한 중요 Trading Event

Order 취소는 Order 삭제가 아니라 상태 변경으로 표현한다.

체결된 Order와 Fill 데이터는 이후 자산 정합성 확인 및 Competition 결과 검증에 사용할 수 있도록 보존한다.

중요 Trading 데이터를 물리적으로 삭제하지 않는다.

루트 `AGENTS.md`의 Data Retention / Soft Delete 정책을 따른다.

---

# 19. Query & Index

Index와 조회 방식은 실제 WHERE/JOIN/정렬 조건, 데이터 규모와 실행 계획을 기준으로 결정한다.
미래 Query를 추측해 Index를 대량 생성하지 않는다.
업무 중복 금지 조건은 필요한 DB Constraint로 보장하며, 이를 단순 성능 최적화와 구분한다.

---
# 20. Competition Finalization

대회 종료는 신규 거래 차단, Pending Order 정리, Open Position 종료, 자산·손익·결과 확정의 순서를 명확히 정의해야 한다.
대량 처리의 중간 실패 후 완료·미완료 대상을 구분하고 재실행해도 누락·중복 반영이 없어야 한다.
처리 중 상태 변경으로 대상이 누락되지 않도록 하며, 처리 단위·Transaction 범위·페이지 방식은 실제 규모와 정합성 요구로 결정한다.

---
# 21. Failure Recovery

실시간 Trading Engine은 장애가 발생할 수 있음을 전제로 설계한다.

예:

- Binance 연결 중단
- Redis 장애
- 애플리케이션 재시작
- DB Transaction 실패
- Trigger Worker 중단

프로세스가 재시작되었다고 해서 영구 Trading 상태가 유실되어서는 안 된다.

PostgreSQL을 영구 Trading 상태의 Source of Truth로 사용한다.

Redis 또는 Memory 상태는 필요할 경우 PostgreSQL에서 다시 구성할 수 있어야 한다.

Pending Order와 Open Position은 애플리케이션 재시작 후 다시 감시할 수 있어야 한다.

장애 발생 시 무한 재시도하지 않는다.

재시도가 필요한 작업은 적절한 Retry 정책과 실패 후 행동을 명확하게 정의한다.

---

# 22. Idempotency

Trading에서 같은 작업이 두 번 실행될 수 있다고 가정한다.

예:

- 동일 Price Event 재처리
- Scheduler 보정 작업
- 네트워크 재시도
- Worker 재시작
- Competition 종료 작업 재실행

동일 Pending Order는 한 번만 체결되어야 한다.

동일 Position은 한 번만 강제청산되어야 한다.

이미 완료된 상태에 동일한 작업이 다시 호출되어도 자산 또는 PnL이 두 번 반영되지 않아야 한다.

Application 코드뿐 아니라 필요한 경우 DB Constraint와 상태 조건을 함께 사용하여 보장한다.

---

# 23. Logging

Trading 오류는 이후 원인 분석이 가능하도록 적절한 Context를 포함하여 기록한다.

예:

```text id="logging-context"
accountId
orderId
positionId
competitionId
tradingSymbolId
symbol
eventType
```

필요한 식별 정보를 로그에 남길 수 있다.

그러나 다음 정보는 로그에 남기지 않는다.

- JWT
- OAuth Token
- 비밀번호
- Secret Key
- 전체 인증 Header
- 기타 민감정보

일반 Exception을 별도의 Error Table에 무조건 저장하지 않는다.

업무적으로 복구 또는 재처리가 필요한 실패는 단순 Application Log와 구분하여 상태 데이터로 관리하는 방식을 검토한다.

---

# 24. Testing

관련 기능을 구현할 때 핵심 업무 불변조건과 실패 경계를 자동 테스트한다. 미래 기능의 테스트를 미리 만들지 않는다.

- TradingSymbol: DB 목록, ACTIVE/INACTIVE, 내부 ID 유지, 검증된 Provider Mapping과 계약 단위
- Market Data: 정규화·파싱, freshness, 중복·역순·잘못된 이벤트, 연결 실패·재연결·종료
- Trading: Market/Limit 및 LONG/SHORT 조건, crossing, 유효한 상태 전이, 중복 체결·청산 방지
- Wallet/Position: 금액·수량·레버리지 계산, 동시 처리와 Transaction Rollback
- Recovery/Competition: 재시작·보조 저장소 유실·대량 처리 중간 실패 후 안전한 재실행

자동 테스트는 외부 Binance의 가용성에 의존하지 않는다. 실제 네트워크 검증은 별도로 실행하고 성공·실패를 사실대로 보고한다.
테스트 실패를 삭제·비활성화해서 숨기지 않는다.

---
# 25. Implementation Boundaries

현재 요청 범위를 넘어 Trading 기능이나 별도 서비스·분산 시스템을 선행 구현하지 않는다.
필요한 의존성은 루트 정책에 따라 Agent가 선택하며 기존 기능으로 충분한지 먼저 확인한다.
기반 기술 변경에는 사전 승인이 필요하다. 그 외 현재 요구를 위한 구현 선택은 진행하고 근거·영향을 완료 보고한다.

---
# 26. Design Principle

Trading 코드를 구현할 때 다음 우선순위를 따른다.

```text id="design-priority"
Correctness
    ↓
Data Consistency
    ↓
Concurrency Safety
    ↓
Failure Recovery
    ↓
Readability
    ↓
Performance
    ↓
Premature Optimization
```

성능을 무시한다는 의미가 아니다.

정확하지 않은 Trading Engine을 빠르게 만드는 것보다 정확하고 복구 가능한 Trading Engine을 먼저 만든다.

성능 최적화가 필요한 부분은 실제 Query Pattern과 측정 결과를 기반으로 최적화한다.

Trading 업무 흐름이 여러 Utility와 Service에 흩어져 이해하기 어려운 구조를 피한다.

코드를 읽었을 때 다음 흐름이 명확하게 드러나야 한다.

```text id="trading-flow"
Order
  ↓
Execution
  ↓
Fill
  ↓
Position
  ↓
Wallet

Price
  ↓
Trigger
  ├─ Limit Order
  └─ Liquidation
```

필요한 복잡성은 숨기지 않되 불필요한 추상화로 Trading 흐름을 감추지 않는다.
