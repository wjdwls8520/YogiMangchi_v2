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

## Key Rules

- Futures only  
  <!-- 현물은 지원하지 않고 선물 모의투자만 운영한다. -->

- Quote asset: USDT  
  <!-- 모든 거래의 기준 화폐, 지갑 자산, 손익 계산 기준은 USDT로 통일한다. -->

- PostgreSQL = Source of Truth  
  <!-- 주문, 포지션, 지갑 등 영구 데이터의 최종 원본은 PostgreSQL이다. -->

- Frontend price is never trusted for execution  
  <!-- 프론트가 보내는 가격은 체결에 절대 사용하지 않고 서버가 관리하는 가격만 신뢰한다. -->

- Browser receives prices from Trading Server WebSocket  
  <!-- 브라우저가 Binance에 직접 연결하지 않고 우리 Trading Server와 WebSocket으로 연결해 가격을 받는다. -->

- Binance WebSocket is centrally managed by Trading Server  
  <!-- Binance 연결은 사용자별로 만들지 않고 Trading Server에서 소수의 연결로 중앙 관리한다. -->

- TradingSymbol list is DB-managed, not hardcoded  
  <!-- 지원 코인 목록은 코드에 고정하지 않고 DB에서 관리한다. 초기 12종목은 Seed 데이터다. -->

- Frontend symbol list comes from Trading Server API  
  <!-- 프론트도 코인 목록을 하드코딩하지 않고 Trading Server API에서 받아 사용한다. -->

- TradingSymbol identity uses internal tradingSymbolId  
  <!-- BTCUSDT 같은 Binance 문자열이 아니라 우리 DB의 tradingSymbolId를 영구적인 TradingSymbol 식별자로 사용한다. -->

- Provider symbols stay behind the provider boundary  
  <!-- 1000PEPEUSDT 같은 Binance 전용 계약명은 Binance 연동 영역에서만 알고 Domain 전체로 퍼뜨리지 않는다. -->

- Market / Limit orders are supported  
  <!-- 시장가와 지정가 주문을 모두 지원한다. -->

- Price crossing must not be missed  
  <!-- 가격이 지정가나 청산가를 정확히 찍지 않고 건너뛰더라도 체결/청산 조건을 놓치면 안 된다. -->

- Wallet / Position consistency is mandatory  
  <!-- 주문, 체결, 청산 중에도 지갑과 포지션 데이터가 서로 어긋나지 않아야 한다. -->

- Trading operations must be idempotent  
  <!-- 같은 체결이나 청산 작업이 두 번 실행돼도 자산이나 손익이 중복 반영되면 안 된다. -->

- Concurrency must be handled explicitly  
  <!-- 동시 주문, 체결, 청산 시 동시성 문제를 반드시 고려하고 필요한 경우 Lock을 사용한다. -->

- Redis is auxiliary and recoverable  
  <!-- Redis는 빠른 조회와 실시간 처리를 위한 보조 저장소이며, 유실되어도 PostgreSQL을 기준으로 복구 가능해야 한다. -->

- Business history is not hard-deleted  
  <!-- 주문, 체결, 포지션 등 중요한 거래 이력은 물리 삭제하지 않고 상태 변경이나 Soft Delete를 사용한다. -->

- Binance reconnect must respect rate limits  
  <!-- Binance 연결이 끊겨도 무한 재접속하지 않고 Backoff/Jitter를 사용해 IP 제한이나 차단을 유발하지 않는다. -->

- Guest and Competition share the same Trading Engine  
  <!-- 게스트 투자와 대회 투자를 별도로 구현하지 않고 같은 주문/체결/청산 엔진을 공유한다. -->

- Correctness and consistency come before optimization  
  <!-- 성능 최적화보다 먼저 정확한 체결, 데이터 정합성, 장애 복구가 보장되어야 한다. -->

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

Yogimangchi V2는 초기 서비스 기준으로 다음 12개 Cryptocurrency를 기본 TradingSymbol으로 제공한다.

| Name | Symbol | TradingSymbol |
| --- | --- | --- |
| Bitcoin | BTC | BTC/USDT |
| Ethereum | ETH | ETH/USDT |
| XRP | XRP | XRP/USDT |
| BNB | BNB | BNB/USDT |
| Solana | SOL | SOL/USDT |
| Cardano | ADA | ADA/USDT |
| Chainlink | LINK | LINK/USDT |
| Avalanche | AVAX | AVAX/USDT |
| Sui | SUI | SUI/USDT |
| Dogecoin | DOGE | DOGE/USDT |
| Pepe | PEPE | PEPE/USDT |
| Shiba Inu | SHIB | SHIB/USDT |

위 12개는 **초기 Seed TradingSymbol**이며 애플리케이션 코드에 영구적으로 고정된 목록으로 취급하지 않는다.

지원 TradingSymbol은 PostgreSQL에서 관리한다.

Rules:

- 사용자에게 표시하는 Coin Name과 Symbol은 실제 Cryptocurrency에서 일반적으로 사용하는 명칭과 Symbol을 사용한다.
- Yogimangchi 전용 임의 Symbol 또는 불필요한 별칭을 만들지 않는다.
- 모든 TradingSymbol의 Quote Asset은 `USDT`로 통일한다.
- Wallet의 기본 자산 역시 `USDT`를 사용한다.
- 지원 TradingSymbol 목록을 Enum이나 여러 코드 위치의 문자열 목록으로 중복 관리하지 않는다.
- 지원 TradingSymbol의 Source of Truth는 Trading Server가 소유하는 영구 TradingSymbol 데이터다.
- 새로운 Cryptocurrency가 Binance에 추가되었다는 이유만으로 Yogimangchi TradingSymbol에 자동 등록하거나 자동 활성화하지 않는다.
- Yogimangchi에서 어떤 TradingSymbol을 제공할지는 별도의 서비스 운영 결정으로 취급한다.

---

## 2.1 TradingSymbol Identity

외부 Provider의 Symbol 또는 Contract Name을 Yogimangchi 내부 데이터의 영구 식별자로 사용하지 않는다.

각 TradingSymbol은 Yogimangchi 내부의 변경되지 않는 식별자를 가진다.

개념적인 구조:

```text id="tradingsymbol-identity"
TradingSymbol

id
name
symbol
quoteAsset
provider
providerSymbol
status
```

예:

```text id="tradingsymbol-identity-example"
id = 1
name = Bitcoin
symbol = BTC
quoteAsset = USDT
provider = BINANCE
providerSymbol = BTCUSDT
status = ACTIVE
```

Order, Position 등 Trading 데이터가 TradingSymbol을 참조해야 하는 경우 외부 Provider Symbol 문자열을 영구 식별자로 사용하지 않고 내부 `tradingSymbolId`를 기준으로 참조하는 것을 기본으로 한다.

외부 Provider에서 Contract Symbol이 변경되어도 Yogimangchi 내부 TradingSymbol의 정체성과 기존 Trading History가 깨져서는 안 된다.

예:

```text id="provider-change"
TradingSymbol ID = 11

기존 providerSymbol
→ ABCUSDT

Provider 변경 발생

새 providerSymbol
→ XYZUSDT
```

이 경우 기존 Order나 Position의 TradingSymbol 정체성이 변경되어서는 안 된다.

Provider 특수 명칭이 Yogimangchi Domain 전체에 전파되지 않도록 한다.

---

## 2.2 Provider TradingSymbol Mapping

Yogimangchi Domain Symbol과 Binance Futures의 실제 Contract Symbol은 서로 다를 수 있다.

외부 Provider Mapping은 Market Data Adapter 또는 이에 준하는 경계에서 명시적으로 관리한다.

다음 정보를 실제 구현 시점의 Binance 공식 Futures Metadata를 기준으로 확인한다.

- Provider Symbol
- Base Asset
- Quote Asset
- Provider Symbol Status
- Price Precision
- Quantity Precision
- Tick Size
- Step Size
- 기타 주문 및 가격 처리에 필요한 Trading Rule

Provider Symbol 또는 Trading Rule을 추측만으로 하드코딩하지 않는다.

TradingSymbol 등록 또는 수정 시 해당 Binance Futures Symbol이 실제로 존재하고 사용할 수 있는지 검증한다.

외부 Provider의 Symbol 변경 또는 계약 구조 변경이 발생했을 때 Domain 전체 코드를 수정해야 하는 구조를 만들지 않는다.

---

## 2.3 TradingSymbol Administration

지원 TradingSymbol은 Admin 기능을 통해 관리할 수 있는 구조를 사용한다.

Admin이 수행할 수 있는 기본 TradingSymbol 관리 기능:

- 신규 TradingSymbol 등록
- TradingSymbol 정보 확인
- TradingSymbol 활성화
- TradingSymbol 비활성화
- Provider Mapping 변경

신규 TradingSymbol 등록 시 관리자가 임의의 문자열만 입력하여 즉시 거래 가능 상태로 만드는 구조를 사용하지 않는다.

개념적인 흐름:

```text id="symbol-admin-flow"
Admin TradingSymbol 등록 요청
        ↓
Binance Futures Metadata 확인
        ↓
Provider Symbol 및 Trading Rule 검증
        ↓
Yogimangchi TradingSymbol 생성
        ↓
필요한 검증 완료
        ↓
ACTIVE
```

Binance에 새로운 TradingSymbol이 상장되었다고 해서 Yogimangchi에 자동으로 추가하지 않는다.

Admin 또는 운영 정책에 의해 명시적으로 등록 및 활성화한다.

TradingSymbol 데이터 역시 루트 `AGENTS.md`의 Data Retention 정책을 따른다.

관리자가 TradingSymbol을 서비스에서 제외하는 경우 Row를 물리 삭제하지 않는다.

기본 상태:

```text id="symbol-status"
ACTIVE
INACTIVE
```

실제 요구사항이 발생하지 않은 상태에서 불필요하게 많은 TradingSymbol Status를 미리 만들지 않는다.

`INACTIVE` TradingSymbol은 기본적으로:

- 신규 주문을 받을 수 없다.
- 일반 사용자의 거래 가능 TradingSymbol 목록에서 제외된다.
- 기존 Trading History는 그대로 유지된다.

TradingSymbol 비활성화 시 기존 Pending Order와 Open Position을 단순 삭제하거나 무효화하지 않는다.

기존 Trading 상태를 어떻게 종료하거나 유지할지는 명시적인 업무 정책에 따라 처리한다.

특히 외부 거래소의 상장폐지와 Yogimangchi 운영상의 단순 비활성화를 같은 상황으로 취급하지 않는다.

---

## 2.4 Frontend TradingSymbol List

Frontend는 지원 Symbol 목록을 자체 코드에 하드코딩하지 않는다.

거래 가능한 TradingSymbol 목록은 `trading-server`가 제공하는 API를 통해 조회한다.

개념적인 구조:

```text id="symbol-list-flow"
PostgreSQL TradingSymbol
        ↓
Trading Server
        ↓
TradingSymbol API
        ↓
Frontend
```

예:

```text id="symbol-api"
GET /api/v1/symbols
```

실제 Endpoint는 API 설계 시 프로젝트 Convention에 맞게 결정한다.

Frontend에 필요한 TradingSymbol 응답에는 필요한 범위에서 다음과 같은 정보를 제공할 수 있다.

```text id="symbol-response"
tradingSymbolId
symbol
name
quoteAsset
displaySymbol
status
pricePrecision
quantityPrecision
```

Frontend가 Binance의 Provider Symbol을 알아야만 정상 동작하는 구조를 피한다.

예를 들어 Yogimangchi 사용자 화면에서는:

```text id="frontend-symbol"
PEPE
PEPE/USDT
```

처럼 Domain 기준 정보를 사용하고, 실제 Binance Contract Mapping은 Trading Server 내부 책임으로 유지한다.

Admin에서 TradingSymbol을 추가하거나 활성화한 경우 Frontend를 다시 배포하지 않아도 지원 TradingSymbol 목록에 반영될 수 있는 구조를 지향한다.

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

Frontend가 전달한 가격을 실제 주문, 체결, PnL 또는 Liquidation 판단의 신뢰 가능한 가격으로 사용하지 않는다.

가격의 신뢰 주체는 항상 Trading Server다.

기본 데이터 흐름:

```text id="server-price"
Binance Futures Market Data
            ↓
      Trading Server
            ↓
Server-authoritative Market Price
        ┌───┴────────────┐
        ↓                ↓
 Trading Engine    Frontend Broadcast
                         ↓
                 Browser WebSocket
```

Trading Server는 현재 사용하고 있는 가격의 다음 정보를 판단할 수 있어야 한다.

- TradingSymbol
- Price
- Timestamp
- Freshness

오래되었거나 정상적인 시장 가격이라고 판단할 수 없는 데이터를 사용하여 새로운 거래를 실행하지 않는다.

Last Price, Mark Price 등 서로 다른 가격 종류를 사용할 경우 각각의 목적을 명확하게 정의하고 암묵적으로 혼용하지 않는다.

---

# 5. Frontend Market Data Delivery

Frontend Browser는 실시간 가격 수신을 위해 Binance WebSocket에 직접 연결하지 않는다.

실시간 가격 전달의 기본 구조는 다음과 같다.

```text id="frontend-market-data"
Binance Futures WebSocket
          ↓
Trading Server
          ↓
Market Price
     ┌────┴────┐
     ↓         ↓
   Memory     Redis
     │
     ↓
Trading Server WebSocket
          ↓
       Browser
```

Rules:

- Binance Market Data 연결은 `trading-server`에서 중앙 관리한다.
- Browser는 실시간 가격을 받기 위해 Yogimangchi Trading Server와 WebSocket 연결을 맺는다.
- 사용자마다 Binance WebSocket Connection을 생성하지 않는다.
- Browser가 Redis에 직접 접근하지 않는다.
- Browser가 최신 가격을 확인하기 위해 Redis를 지속적으로 Polling하는 구조를 사용하지 않는다.
- Redis는 Trading Server 내부에서 실시간 상태 공유, Cache 및 향후 Scale-Out을 지원하는 보조 저장소로 사용할 수 있다.
- 사용자 수와 Redis 조회 횟수가 직접 비례하도록 설계하지 않는다.
- 실시간 가격은 Server가 연결된 Browser에 Push하는 방식을 기본으로 한다.
- 사용자가 필요하지 않은 모든 TradingSymbol의 데이터를 무조건 전송하지 않는다.
- 가능한 경우 현재 화면이나 기능에서 필요한 TradingSymbol만 Subscribe하도록 설계한다.

예:

```text id="symbol-subscribe"
User A → BTC/USDT Subscribe
User B → ETH/USDT Subscribe
User C → BTC/USDT Subscribe

BTC Price Event
→ User A
→ User C
```

화면 표시를 위해 Trading Engine 내부의 모든 Price Event를 Browser에 그대로 전송할 필요는 없다.

사용자 수 또는 TradingSymbol Event 빈도가 증가할 경우 Frontend 전송에는 다음을 검토할 수 있다.

- Throttling
- Latest-value Coalescing
- TradingSymbol별 Subscriber 관리

예:

```text id="frontend-coalescing"
Binance Events

100.01
100.02
100.04
100.03
100.05

↓

Trading Engine
필요한 Price Event 처리

↓

Frontend Broadcast
일정 시간 구간의 최신값 100.05 전달
```

UI 전송 최적화로 인해 Trading Engine의 주문, 체결 또는 Liquidation 판단에 필요한 Price Event까지 누락되어서는 안 된다.

Trading Engine용 가격 처리와 Frontend 표시용 Broadcast 빈도는 서로 다른 책임으로 취급한다.

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

# 9. Price Window

실시간 가격 데이터는 모든 가격 단계를 하나씩 전달한다고 가정하지 않는다.

가격이 크게 움직이면 특정 Limit Price 또는 Liquidation Price를 건너뛸 수 있다.

이를 처리하기 위해 가격 변화의 범위를 판단하는 **Price Window 개념**을 사용할 수 있다.

개념적으로 다음 정보를 사용할 수 있다.

```text id="price-window-fields"
previousPrice
currentPrice
minPrice
maxPrice
```

예:

```text id="price-window-example"
previousPrice = 100
currentPrice  = 95

Price Window = 95 ~ 100
```

이 범위 안에 존재하는 Trigger가 있는지 판단할 수 있다.

Price Window의 핵심 목적은 다음과 같다.

> 가격 이벤트 간 Gap으로 인해 주문 체결 또는 강제청산 조건이 누락되지 않도록 한다.

Price Window는 반드시 JPA Entity 또는 영구 데이터여야 하는 것은 아니다.

구현 시 가장 단순하고 명확한 형태를 선택한다.

---

# 10. Price Trigger Engine

가격 조건을 확인하기 위해 매 가격 이벤트마다 전체 Pending Order 또는 전체 Open Position을 조회하는 구조는 사용하지 않는다.

가격 이벤트를 기준으로 **실제로 영향을 받을 수 있는 후보만 탐색하는 구조**를 설계한다.

검토 가능한 방식:

- Price Event 기반 처리
- Price Window 기반 Range Query
- PostgreSQL Index
- PostgreSQL Partial Index
- Redis Sorted Set
- 필요한 경우 Scheduler 기반 보정 작업

특정 기술을 처음부터 강제하지 않는다.

구현 단계에서 데이터 규모, 복잡도, 복구 가능성과 실제 Query Pattern을 기준으로 가장 적절한 방식을 선택한다.

Redis를 Trigger 탐색 성능 개선에 사용할 수 있다.

그러나 Redis를 Order / Position의 영구적인 Source of Truth로 사용하지 않는다.

Redis 데이터가 모두 사라져도 PostgreSQL의 영구 데이터를 이용하여 필요한 Trigger 상태를 복원할 수 있어야 한다.

---

# 11. Scheduler

Scheduler를 사용하는 것 자체를 금지하지 않는다.

그러나 Scheduler가 주기적으로 전체 Pending Order 또는 Position Table을 계속 Scan하는 구조를 기본 설계로 사용하지 않는다.

Scheduler는 다음과 같은 용도로 사용할 수 있다.

- 실시간 이벤트에서 누락된 작업 보정
- 장애 이후 상태 복구
- 정합성 검사
- 만료 Order 처리
- 운영상 필요한 정기 작업

실시간 체결 및 Liquidation의 주 처리 방식과 보정용 Scheduler의 역할을 명확하게 구분한다.

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

다음 상황은 정상적으로 발생할 수 있다고 가정한다.

- 같은 사용자의 여러 주문 동시 요청
- 새로운 주문과 Pending Order 체결의 동시 실행
- Order 취소와 체결의 동시 실행
- 사용자의 주문과 Liquidation의 동시 실행
- 동일 Pending Order에 대한 여러 Worker의 체결 시도
- 동일 Position에 대한 여러 Liquidation 시도

Wallet, Position, Order의 정합성에 영향을 주는 작업은 동시성 제어 전략을 반드시 검토한다.

Wallet처럼 동일 Account의 자산 상태를 변경하는 핵심 데이터에는 필요한 경우 Pessimistic Lock을 사용할 수 있다.

그러나 모든 Entity와 조회에 Pessimistic Lock을 무분별하게 사용하지 않는다.

Lock은 실제 정합성이 필요한 Transaction 범위 안에서 최소한으로 사용한다.

여러 데이터를 Lock해야 하는 경우 가능한 한 일관된 Lock 순서를 유지하여 Deadlock 위험을 줄인다.

Pessimistic Lock 사용으로 병목이 발생할 정도로 규모가 성장할 경우 다음 전략을 검토할 수 있다.

- Optimistic Lock
- Atomic Update
- Queue / Serialization
- 분산 동시성 제어

현재 필요성이 없는 복잡한 동시성 시스템을 미리 구축하지 않는다.

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

Pending Order와 Liquidation Candidate 탐색에서 전체 Table Scan에 의존하지 않는다.

Index는 실제 Query Pattern을 기준으로 설계한다.

예상 가능한 후보:

```text id="index-examples"
tradingSymbolId + status + triggerPrice
tradingSymbolId + status + liquidationPrice
accountId + status
competitionId + status
```

실제 Column과 Index 순서는 Query가 정해진 후 결정한다.

PostgreSQL의 Partial Index가 유리한 Query에는 이를 검토할 수 있다.

예:

```text id="partial-index"
WHERE status = 'PENDING'
WHERE status = 'OPEN'
```

Unique Index는 성능 최적화를 위한 일반 Index처럼 사용하지 않는다.

Unique Index는 업무적으로 중복 데이터가 존재해서는 안 되는 조건을 DB 수준에서도 보장하기 위해 사용한다.

Index 추가 전 다음을 확인한다.

- WHERE 조건
- JOIN 조건
- ORDER BY
- Cardinality
- 데이터 규모

필요한 경우 `EXPLAIN` 또는 `EXPLAIN ANALYZE`를 사용하여 실제 Query Plan을 검증한다.

추측만으로 Index를 대량 생성하지 않는다.

---

# 20. Competition Finalization

Competition 종료 시 많은 Pending Order와 Open Position이 동시에 존재할 수 있다.

모든 데이터를 하나의 거대한 Transaction에서 한꺼번에 처리하지 않는다.

대량 작업은 일정 크기의 Chunk로 나누어 처리한다.

초기 기준으로 약 500건 단위의 Chunk를 검토할 수 있다.

그러나 500은 절대적인 값이 아니다.

실제 DB 성능, Transaction 시간 및 데이터 규모를 측정하여 변경할 수 있어야 한다.

각 Chunk는 독립적인 Transaction으로 처리할 수 있어야 한다.

대량 처리 중 장애가 발생하더라도 이미 처리된 데이터와 처리하지 못한 데이터를 구분하고 안전하게 작업을 재개할 수 있어야 한다.

멱등성을 고려한다.

데이터를 처리하면서 대상 데이터의 상태가 변경되는 경우 단순 Offset Pagination으로 인해 데이터가 누락되거나 중복될 수 있음을 고려한다.

필요한 경우 ID 기반 Keyset 방식 등을 사용한다.

Competition 종료 시 다음 흐름의 순서를 명확하게 결정한다.

- 신규 거래 차단
- Pending Order 취소
- Open Position 종료
- 최종 PnL 반영
- Wallet 상태 확정
- Competition 결과 확정
- Ranking 계산

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

Trading의 핵심 업무 규칙은 자동 테스트 대상이다.

특히 다음 상황을 중요하게 테스트한다.

### TradingSymbol

- 초기 Seed TradingSymbol 생성
- TradingSymbol 목록 조회
- TradingSymbol 등록
- Binance Futures Symbol 검증 실패
- ACTIVE TradingSymbol
- INACTIVE TradingSymbol
- 비활성 TradingSymbol 신규 주문 차단
- Provider Symbol 변경
- 내부 `tradingSymbolId` 유지
- Frontend TradingSymbol API

### Market Data

- Binance 메시지 정상 Parsing
- Provider Symbol Mapping
- 지원하지 않는 TradingSymbol 처리
- 오래된 Price Event 처리
- WebSocket Disconnect
- Reconnect
- Subscription 복구
- 중복 Connection 방지

### Order

- Market LONG
- Market SHORT
- Limit LONG
- Limit SHORT
- Limit Order 미체결
- Limit Order 체결
- Order 취소
- 이미 취소된 Order 체결 방지

### Price Trigger

- 가격이 Trigger와 정확히 일치
- 가격이 Trigger를 위에서 아래로 통과
- 가격이 Trigger를 아래에서 위로 통과
- 큰 Price Gap
- 동일 Price Event 중복 처리

### Position / Wallet

- Position 생성
- Position 변경
- 여러 TradingSymbol Position
- 서로 다른 Leverage
- USDT Wallet Balance 변경
- Margin 계산
- Realized PnL
- Unrealized PnL

### Liquidation

- LONG Liquidation
- SHORT Liquidation
- Liquidation Price 정확히 도달
- Liquidation Price를 가격이 건너뜀
- 동일 Position 중복 Liquidation 방지

### Concurrency

- 같은 Account의 동시 주문
- 주문과 체결의 동시 실행
- 주문과 Liquidation의 동시 실행
- 동일 Pending Order의 동시 체결 시도
- 동일 Position의 동시 Liquidation 시도

### Transaction

- Fill 생성 후 Position 변경 실패
- Position 변경 후 Wallet 변경 실패
- 중간 Exception 발생 시 전체 Rollback

### Recovery

- Redis 상태 유실
- Application 재시작
- Pending Order 복구
- Open Position 감시 복구

### Competition

- Competition 종료
- Pending Order 대량 취소
- Position 대량 종료
- Chunk 처리
- 중간 실패
- 재실행

모든 테스트를 처음부터 한꺼번에 만들지 않는다.

관련 기능을 구현할 때 해당 핵심 규칙의 테스트를 함께 작성한다.

외부 Binance 서버에 항상 연결되어야만 전체 자동 테스트가 성공하는 구조를 만들지 않는다.

실제 Binance 연결 확인과 내부 로직 자동 테스트를 구분한다.

---

# 25. Implementation Boundaries

현재 요구되지 않은 미래 Trading 기능을 미리 구현하지 않는다.

특히 다음을 요구사항 없이 추가하지 않는다.

- Kafka
- Kubernetes
- 복잡한 분산 Lock
- 별도 Matching Server
- 별도 Liquidation Server
- 별도 Order Server
- Event Sourcing
- CQRS
- Microservice 추가 분리

현재 구조로 해결할 수 없는 실제 문제가 확인되었을 때 해당 기술을 검토한다.

새로운 기술이나 구조가 필요하다고 판단되면 임의로 추가하기 전에 다음을 설명한다.

1. 현재 방식의 문제
2. 새로운 방식이 해결하는 문제
3. 추가되는 복잡성
4. 장점
5. 단점
6. 현재 시점에서 필요한 이유

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