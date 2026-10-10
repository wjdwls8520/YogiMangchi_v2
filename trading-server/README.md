# Trading Server

Yogimangchi V2의 독립 Spring Boot 애플리케이션이다. 현재 PostgreSQL/JPA 기반
TradingSymbol 구조, 공개 거래 종목 조회 API, Binance Mark Price 수신과 정규화된 최신 가격 상태,
Redis 기반 시세 공유, Browser WebSocket, Guest 선물 계정, 시장가/지정가 주문과 교차증거금 청산을 제공한다. 루트 `readme.md`,
루트 및 이 디렉터리의 `AGENTS.md`를 따른다.

## 버전과 의존성

- Java 17, Spring Boot **3.5.16**, Gradle Wrapper **8.14.3**
- springdoc-openapi **2.9.1**, 로컬/테스트 PostgreSQL **17.11-alpine**
- Boot BOM 관리: Security 6.5.11, Hibernate 6.6.53.Final, PostgreSQL JDBC 42.7.11,
  Flyway 11.7.2, Testcontainers 1.21.4

[Boot 공식 기준](https://docs.spring.io/spring-boot/3.5/system-requirements.html)은
Java 17 이상과 Gradle 8.4 이상의 8.x를 지원하므로 기존 Wrapper를 유지한다.
[springdoc 2.x](https://springdoc.org/v2/)는 Boot 3용이며,
[2.9.1 공식 POM](https://repo.maven.apache.org/maven2/org/springdoc/springdoc-openapi/2.9.1/springdoc-openapi-2.9.1.pom)의
부모 버전도 Boot 3.5.16이다. Wrapper 배포 ZIP의 SHA-256 검증도 유지한다.

**운영 주의:** [공식 발표](https://spring.io/blog/2026/06/25/spring-boot-3-5-16-available-now/)상
3.5.16은 3.5.x의 마지막 OSS 릴리스다. 프로젝트의 명시적 버전 기준을 따랐으며,
운영 배포 전 지원 중인 버전으로 전환하거나 별도의 보안 패치 공급 방식을 결정해야 한다.

| 의존성 | 용도 |
| --- | --- |
| `spring-boot-starter-web` | Spring MVC와 HTTP 서버 |
| `spring-boot-starter-security` | 공개 경로 지정과 나머지 요청 차단 |
| `spring-boot-starter-data-jpa` | TradingSymbol 영속성과 트랜잭션 |
| `spring-boot-starter-data-redis` | Lettuce 연결, 공유 Snapshot, Pub/Sub와 재생 가능한 Stream |
| `spring-boot-starter-websocket` | Browser HTTP Upgrade, Session과 Raw JSON WebSocket 전송 |
| `postgresql` (runtime) | PostgreSQL JDBC 연결 |
| `flyway-core`, `flyway-database-postgresql` (DB 모듈은 runtime) | SQL 마이그레이션과 Seed 이력 |
| `springdoc-openapi-starter-webmvc-ui` | Swagger와 OpenAPI 생성 |
| `spring-boot-starter-test`, `spring-security-test` | JUnit, MockMvc, 보안/오류 테스트 |
| `spring-boot-testcontainers`, `org.testcontainers:postgresql` | 실제 PostgreSQL 통합 테스트 |
| `junit-platform-launcher` (test runtime) | Gradle 테스트 실행 |

Boot 4의 `starter-webmvc`, `starter-webmvc-test`, `starter-security-test`를 교체했다.
`UserDetailsServiceAutoConfiguration`과 `AutoConfigureMockMvc` import도 Boot 3용으로 변경했다.
Gradle `platform`으로 Boot BOM을 사용하며 별도의 dependency-management 플러그인은 없다.
Redis는 현재 공유 가격/이벤트 기능에 사용한다. 기존 JDK WebSocket과 JPA는 Redis 프로토콜을
제공하지 않으므로 Boot BOM이 관리하는 Spring Data Redis/Lettuce를 사용한다. 별도 버전을 고정하지 않는다.
Validation, Lombok, JWT/OAuth2, H2 의존성은 추가하지 않았다. 트리거/주문은 기존 JPA/JDBC와 Redis 기능을 재사용한다.

## PostgreSQL과 마이그레이션

Content와 Trading은 공용 Database `yogimangchi`를 사용하고, 애플리케이션별 Schema와
데이터 소유권을 분리한다. Trading은 `trading`, 향후 Content는 `content` 스키마를 사용한다.
`trading`은 Trading Server의 Flyway/Hibernate 공통 기본 스키마다.

- V1: 테이블과 PK, Unique/Check/Not-null 제약 생성
- V2: 공식 Binance 메타데이터로 확인한 초기 12개 종목 등록
- V3: Provider 계약 한 단위에 포함된 Domain 자산 수량 `provider_unit_multiplier` 추가
- Flyway가 순서와 체크섬을 관리하며 정상 적용된 Seed는 재시작 시 다시 실행하지 않는다.
- 운영 중 변경한 상태/Provider Mapping을 Seed가 덮어쓰지 않는다.
- 적용한 마이그레이션은 수정하지 않고 새 버전 파일을 추가한다.
- Hibernate `ddl-auto=validate`는 Entity/테이블 매핑만 검사하며 스키마를 생성·수정하지 않는다.
- `open-in-view=false`, `spring.sql.init.mode=never`, `spring.flyway.clean-disabled=true`를 사용한다.
- DB 연결·마이그레이션·매핑 검증에 실패하면 기동을 실패시킨다.

Flyway는 PostgreSQL SQL 파일만으로 변경 이력과 재현성을 확보할 수 있어 선택했다.
별도의 XML/YAML 변경 모델은 필요하지 않다. SQL 버전 관리가 추가되고 이미 적용한 파일의
수정/임의 롤백을 피해야 한다는 운영 부담이 있다.
[Spring DB 초기화 지침](https://docs.spring.io/spring-boot/3.5/how-to/data-initialization.html)을 따른다.

V3는 기존 ID/상태/Provider Symbol을 유지한다. 동일 단위 Mapping은 1,
검증된 PEPE/1000PEPEUSDT 및 SHIB/1000SHIBUSDT Mapping은 1000으로 이관한다.
검증되지 않은 다른 계약명 Mapping이 있으면 배수를 추측하지 않고 Migration 전체를 Rollback한다.
이 경우 해당 계약 단위를 공식 metadata로 확인하고 V3 적용 계획을 보완해야 한다.
배수는 NOT NULL / 양수 제약을 가지며 기본값은 없다. 등록과 Mapping 변경 시 배수를 명시한다.
Java Mapping 검증은 정확한 Decimal 나눗셈이 불가능한 배수도 거부한다.

## 환경변수

| 변수 | 의미                                         |
| --- |--------------------------------------------|
| `TRADING_SERVER_PORT` | HTTP 포트, 기본 8081                           |
| `YOGIMANGCHI_DB_USERNAME` | 공용 PostgreSQL 로컬 계정                        |
| `YOGIMANGCHI_DB_PASSWORD` | 공용 PostgreSQL 로컬 비밀번호                      |
| `YOGIMANGCHI_DB_PORT` | Compose에서 명시하는 DB 포트; Spring Boot 기본값 5432 |
| `YOGIMANGCHI_REDIS_PORT` | Compose에서 명시하는 Redis 포트; 예시 6379           |
| `YOGIMANGCHI_REDIS_HOST` | Trading Server의 Redis 주소; 기본 localhost |
| `YOGIMANGCHI_REDIS_PASSWORD` | Redis 인증이 필요한 배포 환경의 비밀번호; 기본 미설정 |

현재는 `application.yml` 하나를 사용하고 Profile을 분리하지 않는다. 하나의 로컬 계정으로
Flyway 초기화와 애플리케이션을 실행한다. JDBC URL은 `localhost`의 지정 포트와
고정 Database 이름 `yogimangchi`로 구성하며, 기본 Schema는 `trading`이다.
실제 비밀번호/운영 주소를 저장소에 넣지 않는다. 루트 `.env.example`은 예시이며
**Spring Boot는 `.env`를 자동으로 읽지 않는다.** 셸/IDE/배포 환경에서 변수를 전달한다.
루트 `.env`는 Docker Compose용이며, IntelliJ에서 Trading Server를 실행할 때는
Run Configuration의 Environment Variables에 Spring Boot용 환경변수를 별도로 전달한다.

## 로컬 실행

JDK 17과 Docker Desktop Linux 엔진을 준비한다. 루트 `.env`가 없다면 루트
`.env.example`을 `.env`로 복사하고 로컬 DB 비밀번호를 입력한다. Repository 루트에서
공용 `docker-compose.yml`로 인프라를 실행한다.

```powershell
docker compose up -d
```

그 후 IntelliJ에서 `trading-server`를 Spring Boot/Gradle 프로젝트로 열고 위 환경변수를
Run Configuration에 설정해 실행한다. 셸에서 실행할 경우 Repository 루트에서
아래 명령을 사용한다. 비밀번호 입력은 PowerShell 7 기준이다.

```powershell
Set-Location trading-server
$env:TRADING_SERVER_PORT = '8081'
$env:YOGIMANGCHI_DB_PORT = '5433'
$env:YOGIMANGCHI_DB_USERNAME = 'yogimangchi_local'
$env:YOGIMANGCHI_DB_PASSWORD = Read-Host 'Local PostgreSQL password' -MaskInput
.\gradlew.bat bootRun
```

Compose는 PostgreSQL과 Redis만 시작하며 localhost에만 포트를 공개한다.
PostgreSQL은 `postgres-data` Volume에 데이터를 보존하며 Redis Volume은 추가하지 않는다.
PostgreSQL이 연결을 받을 준비가 된 뒤 Trading Server를 실행한다.
초기 계정은 **로컬 개발 전용**으로 운영에 사용하지 않는다. 기존 Volume의 계정/비밀번호는
환경변수 변경만으로 바뀌지 않는다. 중지는 Repository 루트에서 `docker compose down`이다.
`-v`는 데이터를 삭제하므로 데이터 폐기가 필요한 경우에만 사용한다.
Docker CLI가 PATH에 없다면 설치된 CLI의 절대 경로를 사용하거나 PATH를 구성한다.

Compose 위치 또는 Volume 키 변경으로 Volume의 실제 이름이 달라질 수 있다.
기존 Volume을 사용하는 경우 실행 전에 기존 이름과 재사용 설정을 확인하고 데이터를 삭제하지 않는다.

- 공개 API: `http://localhost:8081/api/v1/symbols`
- Swagger: `http://localhost:8081/swagger-ui/index.html`
- OpenAPI: `http://localhost:8081/v3/api-docs`, `/v3/api-docs.yaml`

## 운영 계정 경계

현재 로컬 개발에서는 운영 전용 계정이나 별도 운영 설정을 사용하지 않는다.
운영 계정 권한과 환경 설정 분리는 실제 운영 배포가 필요해질 때 결정한다.
Swagger/OpenAPI는 기본 설정에서 활성화하며 서버는 `127.0.0.1`에 바인딩한다.
운영 배포 시에는 Swagger/OpenAPI가 외부에 노출되지 않도록 별도 차단 구성을 도입한다.
운영 TLS, 비밀값 전달, 백업/복구 및 Nginx/네트워크의 포트 노출 제한은 배포 시 별도로 검증한다.

## API와 보안

`GET /api/v1/symbols`는 인증 없이 ACTIVE 종목을 Symbol, ID 오름차순으로 반환한다.
활성 종목이 없으면 `[]`다. 현재 작은 기준정보 목록으로 페이징을 도입하지 않았다.

```json
[{"id":1,"symbol":"BTC","name":"Bitcoin","quoteAsset":"USDT","displaySymbol":"BTC / USDT"}]
```

ID는 예시다. 클라이언트는 목록과 ID를 하드코딩하지 않고 API 값을 사용한다.
Provider/Provider Symbol/status는 공개 DTO에 없다. Repository는 필요한 컬럼을 DTO로 조회하고
Service가 읽기 전용 트랜잭션을 가진다.

Symbol 목록, Guest 계정 생성, 공개 가격 WebSocket과 로컬 문서에 필요한 경로만 공개한다.
계정 조회는 아래 Guest Bearer 인증을 요구하며 명시하지 않은 다른 업무 경로는 차단한다.
기본 계정 미생성, 폼 로그인/Basic/로그아웃/요청 캐시 비활성화를 유지한다.
거래 REST는 Stateless이며 Cookie 인증이 없으므로 `/api/v1/trading/**`만 CSRF 검사에서 제외한다.
다른 경로에는 기존 CSRF 보호를 유지한다. REST CORS 허용 Origin은 기본 localhost/127.0.0.1의 5173이며
`TRADING_HTTP_ALLOWED_ORIGINS`에 쉼표로 구분한 정확한 Origin을 설정한다. `*`/Cookie Credentials는 허용하지 않는다.

현재 필요한 업무 오류는 `BusinessException`/`ErrorCode`와 공통 ProblemDetail 응답으로 처리한다.
전역 `ApiExceptionHandler`는 MVC 오류 처리를 유지하고 예상하지 못한 오류를
`application/problem+json`의 500 응답으로 반환한다. 내부 예외/SQL/Stack Trace는 응답에 넣지 않고
원인은 서버 로그에 남긴다. Service에서 예외를 삼키지 않는다.

### Guest 계정·Wallet·Position Core

| Method | Endpoint | 인증/응답 |
| --- | --- | --- |
| POST | `/api/v1/trading/accounts/guest` | 공개. 10,000 USDT 계정과 7일 Guest Credential 생성, 201 |
| GET | `/api/v1/trading/account/wallet` | Bearer. 자기 Wallet과 현재 평가 금액 |
| GET | `/api/v1/trading/account/positions` | Bearer. 자기 OPEN Position 목록 |
| GET | `/api/v1/trading/account/summary` | Bearer. 일관된 계정·Wallet·OPEN Position 평가 Snapshot |

Guest 생성 응답은 `accountId`, `status`, `quoteAsset`, `initialBalance`, `accessToken`, `tokenType`, `expiresAt`이다.
`accessToken`은 암호학적으로 무작위인 256-bit 불투명 문자열이고 `Authorization: Bearer <accessToken>`으로 보낸다.
서버는 PostgreSQL에 SHA-256 Hash만 저장하며 원문은 생성 응답에서 한 번만 제공한다. URL·로그에 토큰을 넣지 않는다.
이 Credential은 현재 Trading MVP의 계정 접근권이며 Content 로그인/JWT를 대신하는 영구 인증 설계는 아니다.
토큰을 잃거나 7일이 지나면 해당 계정에 다시 접근할 수 없다. 계정/이력은 삭제되지 않으며 새 Guest를 생성한다.
Frontend는 우선 메모리에 보관하고 새로고침 복구를 위한 브라우저 저장 선택에는 XSS 위험을 고려한다.
인터넷 공개 전에는 TLS, Gateway의 Guest 생성/인증 요청 제한과 최종 Content JWT 전환을 검증해야 한다.
계정 ID를 경로·요청에 넣어 다른 계정에 접근하는 API는 제공하지 않는다. 만료/변조/없는 Credential은 401이다.

V4는 `trading_account`, `wallet`, `position`을 생성한다. 계정은 내부 ID, 상태, Credential Hash/만료,
생성 시간과 마지막 재무 변경 시각을 가진다. Wallet은 계정당 하나이며 실제 잔액, 사용/예약 Margin,
누적 실현 PnL을 보존한다. Position은 개별 체결 Lot 단위로 독립된 LONG/SHORT 수량·진입가·Leverage·Margin,
OPEN/CLOSED/LIQUIDATED 상태·실현 PnL·청산가·생성/종료 시각을 가진다. 같은 종목의 여러 Lot도 USDT Wallet을 공유한다.
시장가 주문은 개별 Position Lot을 만들고 부분/전체 종료를 지원한다. 동일 종목 합산은 하지 않는다.
Position의 `quantity`와 `margin`은 잔여 값이며 `realizedPnl`은 누적 실현 손익이다.
V7은 기존 원래 수량/증거금을 `initial_quantity`/`initial_margin`에 보존하고 종료된 Lot의 잔여 값을 0으로 이관한다.
진입가/Leverage는 유지하며 마지막 종료 가격과 시각은 Position에, 각 부분 체결은 Order/Fill에 보존한다.

| Method | Endpoint | 목적 |
| --- | --- | --- |
| POST | `/api/v1/trading/account/orders` | `type=MARKET/LIMIT`, `tradingSymbolId`, `side=LONG/SHORT`, 문자열 `quantity`, `leverage`로 주문. LIMIT만 문자열 `limitPrice` 필요 |
| POST | `/api/v1/trading/account/positions/{positionId}/close` | 시장가 부분/전체 종료. `{"quantity":"0.01"}`; Body/quantity 생략 시 잔여 전체 종료 |
| POST | `/api/v1/trading/account/positions/{positionId}/close-orders` | 지정가 부분/전체 종료 예약. `{"quantity":"0.01","limitPrice":"70000"}`; quantity 생략 시 현재 잔여 전체 수량 예약 |
| GET | `/api/v1/trading/account/orders?beforeId=&limit=50` | 자기 주문/체결 이력. ID 내림차순, 최대 100개 |
| GET | `/api/v1/trading/account/orders/pending` | 자기 PENDING 지정가 목록 |
| POST | `/api/v1/trading/account/orders/{orderId}/cancel` | 지정가 취소. Body/Idempotency-Key 불필요, 상태 전이 자체가 멱등적 |
| GET | `/api/v1/trading/status` | 공개. Trigger 기반시설 READY/RECOVERING |

status 외에는 Guest Bearer 인증이 필요하다. 주문/종료의 `Idempotency-Key`는 8~100자 영문/숫자/`_`/`-`다.
주문/종료 요청은 `Content-Type: application/json`으로 전송한다. 시장가 전체 종료는 빈 Body 또는 `{}`를 사용할 수 있다.
빈 문자열/공백 수량은 생략으로 간주하지 않고 400으로 거절한다.
계정별 동일 Key/동일 요청은 최초 결과를 반환하고 다른 요청은 409 `IDEMPOTENCY_CONFLICT`다.
네트워크 응답 유실 시 같은 Key로 재시도한다. 재전송은 가격이 unavailable이어도 동일 주문을 돌려준다.
지정가가 이미 체결/취소된 경우 그 주문의 현재 상태를 반환하며 새 주문을 만들지 않는다.
주문/종료 성공은 200이며 Response의 `fill`에 체결가·가격 이벤트 시각·체결 시각·실현 PnL이 있다.
부분 종료의 동일 Key/다른 수량은 409다. 수량은 양수·최대 소수 8자리이며 잔여량 초과는 409 `CLOSE_QUANTITY_EXCEEDED`다.
지정가 종료도 같은 멱등성 계약을 사용하며 수량 또는 지정가가 달라지면 충돌한다. 생략한 수량은 최초 주문 시 확정한다.
종료에는 신규 진입 최소 Notional을 적용하지 않아 작은 잔여량도 정리할 수 있다. Fill은 실제 체결 `quantity`도 반환한다.
Client의 임의 가격은 사용하지 않는다. 계정별 Key UNIQUE, Position별 OPEN/LIQUIDATE UNIQUE,
Fill의 order_id UNIQUE와 계정 Row Lock을 함께 사용한다. Position/Wallet/Order/Fill은 하나의 Transaction이다.
Commit 이후에만 성공 로그를 남긴다. Lock timeout/교착은 전체 rollback하며 무한 재시도하지 않는다.
신규 주문에는 ACTIVE 종목과 보유 종목 전체의 fresh 가격, 충분한 가용 Margin이 필요하다.
종료도 전체 fresh 평가를 요구하며 유지증거금 이하의 계정은 `ACCOUNT_AT_RISK`로 차단한다.
손실 Lot 종료로 현금이 음수가 되면 거절한다. 수익 Lot을 먼저 종료해야 하는 경우가 있다.
가격이 새로 도착했지만 위험 처리가 끝나지 않았으면 503 `ENGINE_RECOVERING`이다. 동일 Key로 짧은 간격을 두고 재시도한다.
단순 READY 상태도 개별 종목의 freshness 또는 주문 허용을 보장하지 않는다.

### 지정가·가격 Trigger·강제청산

```text
Binance -> normalization -> LatestPriceStore -> bounded publisher -> Redis
                                  |                          |       |- Snapshot (TTL)
                                  |                          |       |- Pub/Sub -> Client WS -> Browser
                                  |                          |       `- Stream -> ordered Trigger Worker
REST Order/Close -----------------+--------------------------+----------------|
                                                                            v
                                                      Account DB Row Lock -> risk / order
                                                        -> Fill + Position + Wallet -> PostgreSQL
```

지정가 **OPEN**은 먼저 PENDING으로 저장하고 `limitPrice * quantity / leverage`를 예약한다.
OPEN/CLOSE 합계 계정당 최대 100개다. OPEN LONG은 새 Mark가 지정가 이하, SHORT는 지정가 이상일 때 체결한다.
지정가 **CLOSE**는 기존 Position ID를 대상으로 수량만 예약한다. CLOSE LONG은 Mark가 지정가 이상,
CLOSE SHORT는 지정가 이하일 때 체결한다. Side/종목/Leverage는 대상 Lot에서 가져오며 신규 노출이나 증거금을 만들지 않는다.
정확히 같은 가격을 찍을 필요가 없으며, 체결은 주문 수량 전체에 대해 수행한다(호가 유동성에 따른 분할 체결은 없다).
현재 가격에 이미 충족되는 지정가도 PENDING으로 생성한 후 다음 유효한 이벤트에서 판정한다.
체결가는 이벤트의 정규화된 Mark다. Provider 계약 수량/이름은 주문 엔진에 들어오지 않는다.
실제 체결 시 가격·Margin·Notional·최대 Lot 수를 재검증한다. 부족하면 REJECTED와 원인을 남기고 예약을 반환한다.
취소와 체결은 같은 계정 Row Lock으로 직렬화한다. 취소가 먼저면 CANCELED, 체결이 먼저면 취소는 409다.
취소 재전송은 CANCELED를 그대로 반환하며, 가격/Redis 장애 중에도 취소할 수 있다.
Position의 `reservedCloseQuantity`는 PENDING CLOSE 수량 합계이고 `freeCloseQuantity = quantity - reservedCloseQuantity`다.
Wallet의 `reservedMargin`은 OPEN 예약 증거금이며 청산 예약 수량과 무관하다. Order 응답에도 두 예약값을 구분한다.
시장가 종료와 새 지정가 종료는 **예약되지 않은 수량만** 사용한다. 예를 들어 1 BTC 중 0.7 BTC 예약 상태에서
시장가 0.5 BTC 종료는 409로 거절하며, 기존 지정가를 자동 축소/취소하지 않는다. 먼저 취소하거나 0.3 BTC 이하로 종료한다.
Body/quantity 없는 전체 종료 역시 예약이 있다면 거절한다. 성공한 부분 종료 후에도 남은 예약은 잔여 수량을 넘지 않는다.
같은 계정의 생성/취소/체결/강제청산은 DB Row Lock 후 최신 상태로 검증한다. 강제청산은 위험 검사를 먼저 수행하고
모든 PENDING OPEN 증거금과 CLOSE 수량 예약을 반환한 뒤 **남은 수량만** 정산한다.
동일 Tick에서 위험 조건이 충족되지 않은 주문은 ID 순서로 처리한다. CLOSE도 현금 잔액을 음수로 만드는 체결은
`INSUFFICIENT_SETTLEMENT_CASH`로 거절하고 해당 수량 예약을 반환한다. 나머지 주문은 보존한다.
V8은 수량 예약의 `0 <= reserved <= remaining` 제약과 CLOSE 대상 Position 보존 제약을 추가한다.
트리거 후보는 종목/OPEN·CLOSE/방향/지정가 부분 인덱스와 계정 ID keyset으로 조회하며 전체 주문을 매 Tick 읽지 않는다.
종목 비활성화를 실제 관리하는 API는 없다. Trigger 시 이미 INACTIVE인 신규 진입 주문은 REJECTED 처리한다.
관리 기능 도입 전에는 OPEN Position/PENDING Order가 있는 종목을 임의 비활성화하지 않는다.

유지증거금은 `sum(mark * quantity * 0.005)`다. 교차증거금의 `equity <= maintenanceMargin`이면
계정의 모든 OPEN Lot을 같은 fresh 가격 벡터로 청산하고 모든 PENDING 예약을 반환·REJECTED 처리한다.
청산가를 정확히 찍지 않고 건너뛰어도 `<=` 비교로 감지한다. 반대 방향/다른 종목의 PnL도 합산한다.
청산 Position/Order/Fill과 Wallet은 계정 단위 하나의 Transaction이다. 이력 Action은 LIQUIDATE다.
큰 가격 Gap의 손실을 0으로 잘라내지 않는다. 잔액이 0 이하면 BANKRUPT로 신규 거래를 차단하고 실제 손실을 보존한다.
청산 후 잔액이 양수면 ACTIVE이며 새 거래가 가능하다. 자동 부채 보전/보험 기금은 제공하지 않는다.
이것은 명시적인 모의투자 정책이며 Binance Maintenance Tier, Funding, 수수료 또는 실제 매칭 엔진의 복제가 아니다.
현재 OPEN/CLOSE/LIQUIDATE의 Fee는 모두 0이며 기존 무수수료 정책을 유지한다. 정해지지 않은 Maker/Taker 요율을
임의 적용하지 않는다. 실제 거래소 비용을 비교하는 수익률로 해석해서는 안 되며 Funding 역시 계산하지 않는다.

Worker는 매 Tick 전체 주문을 읽지 않는다. 종목별 OPEN Position 인덱스와 LONG/SHORT 지정가 범위 인덱스로
후보 계정을 100개씩 Keyset 조회하고, 계정 잠금 후 최대 100개 PENDING/OPEN 항목을 재검증한다.
가격 수신 Thread에는 DB/Redis/socket I/O를 추가하지 않는다. HTTP 요청과 Worker가 잠그는 업무 단위는 항상 계정 하나다.
Wallet/Position/Order는 그 뒤에 읽으므로 서로 다른 계정을 역순으로 잠그는 경로가 없다.
단일 서버의 주문/수동 종료는 DB 계정 잠금 전에 짧은 읽기 Gate를 얻고 Commit까지 유지한다.
가격 이벤트 처리는 같은 Gate의 쓰기 권한으로 후보 조회부터 체크포인트까지 진행한다.
따라서 아직 Commit되지 않은 새 Position을 건너뛰어 순간 가격 crossing을 놓치지 않는다.
Gate는 현재 노드의 처리 순서를 위한 것이며 재무 정합성은 PostgreSQL이 보장한다. Gate 대기도 유한하다.
DB 교착/Lock timeout이면 해당 Transaction 전체가 rollback한다. HTTP는 409, Worker는 1~30초 Backoff로 재처리한다.
잘못된 이벤트/계속 실패하는 DB 작업을 조용히 건너뛰지 않고 RECOVERING으로 거래를 막고 로그에 남긴다.

V6는 지정가 상태/예약/완료 시각/거절 원인, 필요한 Partial Index와 `market_trigger_cursor`를 추가한다.
단일 순서 Worker는 Redis XRANGE와 PostgreSQL의 Stream ID/가격 벡터 체크포인트를 사용한다.
모든 후보 계정 Transaction이 Commit된 뒤에만 체크포인트를 전진시킨다. 직전 중단 이벤트는 다시 처리하며
이미 종료된 Order/Position과 Fill UNIQUE 제약으로 중복 반영하지 않는다. Redis Consumer Group과 별도 ACK 상태를
중복 관리하지 않는 이유는 현재 단일 순서 Worker의 완료 위치가 이미 PostgreSQL에 있기 때문이다.
서버 재시작으로 메모리 인덱스가 사라져도 PostgreSQL 후보 조회와 체크포인트로 재개한다.

Redis 장애/Producer 누락/처리 지연 중에는 신규 주문과 수동 종료를 차단한다. UI는 유효한 로컬 가격을 계속 볼 수 있다.
Redis 복구 후 fresh 이벤트로 DB 노출을 재평가하고, 해당 가격까지 위험 처리가 끝나야 주문을 받는다.
Stream 보존 구간에서 짧은 지연의 `100 -> 98 -> 102`는 순서대로 처리하여 중간 crossing을 보존한다.
단, **freshness 한도 5초를 넘긴 이벤트로 과거 가격 체결을 소급하지 않는다.** 만료된 이벤트, Stream 삭제/Trim,
Producer 유실은 경고와 DB `gap_count`로 기록한다. 복구 시 현재 fresh 가격으로 보유 포지션·대기 주문을 재평가한다.
장애 구간의 모든 중간 가격을 복원하거나 이미 지나간 청산을 정확히 재현한다고 보장하지 않는다.
이를 요구하는 실제 운영 단계에서는 영속 가격 원장과 역사적 평가/복구 정책을 추가로 설계해야 한다.

현재 한 개의 Binance 수집자/Trigger Worker만 실행한다. PostgreSQL 잠금·Unique 제약·공유 Redis 이벤트는
다중 노드에서도 재사용할 수 있지만, 여러 Worker의 순서/체크포인트 소유권은 아직 조정하지 않는다.
서버 2/3을 추가하기 전에 수집 Leader와 Trigger Partition/Ownership, 재분배 정책을 구현해야 한다.
`TRADING_TRIGGER_ENABLED=false`는 문서 추출/격리 테스트용이며 주문 Gate를 우회하지 않는다.

금액/가격은 NUMERIC(38,18), Domain 자산 수량은 NUMERIC(28,8)이다. `execution.TradingMath`에서
금액/PnL HALF_EVEN 18자리, 최초 Margin CEILING 18자리, Leverage 1~20, 1~1,000,000 USDT Notional,
최대 10^12 수량/100개 OPEN Lot 정책을 정의한다. JSON 금액·수량은 정밀도를 보존하는 문자열이다.
LONG PnL은 `(mark-entry)*quantity`, SHORT는 그 반대다. 평가자산은 `balance + unrealizedPnl`이며
사용 가능 금액은 `max(0, min(balance, equity) - usedMargin - reservedMargin)`이다.
미실현 이익으로 추가 Margin을 만들지 않으며 손실은 구매력을 줄인다. Margin은 현금 지출이 아닌 사용 제한이다.
부분 종료의 반환 Margin은 `남은 Margin * 종료 수량 / 남은 수량`을 18자리 내림한다.
마지막 종료에서는 잔여 Margin 전부를 반환하므로 반복 부분 종료 후 증거금 잔재가 남지 않는다.

계정 Snapshot은 PostgreSQL 계정 Row Lock → Wallet → Position 순서로 읽어 동시 재무 변경과 섞이지 않게 한다.
Lock 대기는 최대 2초이며 경합 실패는 409 `TRADING_BUSY`다. 가격은 하나의 메모리 Snapshot으로 평가한다.
하나의 보유 종목이라도 FRESH가 아니면 전체 `unrealizedPnl/equity/availableBalance`는 null이고
`valuationStatus=UNAVAILABLE`이다. 해당 Position의 Mark/PnL도 null이며 마지막 가격을 0 또는 현재 값으로 취급하지 않는다.
Open Position이 없는 계정의 평가 금액은 DB 현금만으로 계산할 수 있다. 시장 연결 상태와 DB 잔액을 혼동하지 않는다.

## Binance Mark Price 수신

서버 준비 완료 후 DB의 ACTIVE/BINANCE 종목을 조회해 하나의 USDⓈ-M Futures Combined Stream에 연결한다.
`wss://fstream.binance.com/market/stream?streams=<providerSymbol 소문자>@markPrice@1s/...`를 사용한다.
API Key와 추가 의존성 없이 Java 17 기본 WebSocket을 사용하며, 재연결 시 DB 대상을 다시 조회한다.
현재 연결 도중 DB 변경을 즉시 반영하는 Admin/동적 구독 기능은 구현하지 않았다.

`[Binance WS]` 로그로 연결 상태와 10초 단위 수신 통계를 확인한다.
`[MARK PRICE]`에는 내부 ID, Domain Symbol, Provider Symbol, `providerMarkPrice`, `domainMarkPrice`,
Binance eventTime, 서버 receivedAt이 기록된다. 가격은 메모리와 Redis에 보관하며 PostgreSQL에는 저장하지 않는다.
가격 로그 설정 `BINANCE_MARK_PRICE_LOG_PRICES`는 기본 false다. 가격은 DEBUG이므로
기본 INFO 수준에서는 출력하지 않는다. 개발 검증 시에만 true로 지정해 가격을 INFO로 출력한다. 연결 전체를 끄려면
`BINANCE_MARK_PRICE_ENABLED=false`를 사용한다. 기존 DB/서버 환경변수와 함께 IDE 실행 환경에 지정한다.

연결 실패/종료 시 1·2·4·8·16·30초 상한의 80~100% 무작위 지연 후 재연결한다.
onOpen만으로 재시도 횟수를 초기화하지 않는다. 첫 유효한 정규화 가격을 저장한 뒤
`HEALTHY` 로그와 함께 초기화하며 복구까지 걸린 시간도 이 시점을 기준으로 기록한다.
이전 연결의 늦은 callback은 무시한다.
5초마다 확인해 마지막 정상 데이터 수신 후 15초 이상 침묵하면 재연결한다.
이는 연결 전체의 수신 중단 감지이며 아래 종목별 freshness와 별개다.
24시간 연결 제한에 대비해 23시간 50분에 연결을 교체한다. Java WebSocket의 자동 Pong을 사용한다.
종료 시 재시도를 취소하고 Close를 전송하며, 응답을 최대 2초 기다린 후 연결을 정리한다.

기준 문서: [Binance 연결 정책](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect),
[Mark Price Stream](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market),
[Java 17 자동 Pong](https://docs.oracle.com/en/java/javase/17/docs/api/java.net.http/java/net/http/WebSocket.Listener.html#onPing(java.net.http.WebSocket,java.nio.ByteBuffer)).

### 가격 단위와 최신 상태

2026-10-08 [공식 exchangeInfo](https://fapi.binance.com/fapi/v1/exchangeInfo)에서
BTCUSDT의 baseAsset=BTC, 1000PEPEUSDT의 baseAsset=1000PEPE,
1000SHIBUSDT의 baseAsset=1000SHIB, quoteAsset/marginAsset=USDT를 확인했다.
Provider 한 단위의 Mark Price를 DB Mapping의 배수로 나눠 Domain 자산 한 단위당 USDT로 정규화한다.
예: 1000PEPEUSDT의 `0.0098 / 1000 = 0.0000098 USDT/PEPE`.
BigDecimal의 정확한 나눗셈을 사용하며 임의 rounding이나 Symbol 문자열에서의 배수 추론은 없다.

`marketdata.LatestPriceStore`는 내부 ID별 불변 `LatestMarkPrice`와 가용 상태를 메모리에 보관한다.
짧은 synchronized 연산으로 갱신/조회/연결 상태 변경을 보호한다.
소비자는 `find(id)`에서 가격 객체(eventTime/receivedAt 포함)와 다음 상태를 함께 받는다.

- MISSING: 해당 종목의 가격 없음
- FRESH: 현재 구독에서 정상 수신했고 eventTime과 receivedAt이 모두 5초 미만
- STALE: 종목의 timestamp가 유효 기간을 벗어남
- UNAVAILABLE: 연결이 끊겼거나 재구독 후 해당 종목의 새 가격을 아직 받지 못함

최대 1초의 미래 clock skew만 허용한다. 서버 시간 동기화가 필요하다.
오래된/과도하게 미래인 메시지, 중복·역순 eventTime, 잘못된 payload는 저장값을 갱신하지 않는다.
재연결 후에도 종목마다 새 가격을 받아야 FRESH가 되며 구독에서 빠진 종목은 제거한다.
현재 연결 중 DB Mapping/활성 상태 변경을 즉시 감지하는 기능은 없다.
재시작 시 Store는 비어 있으며, 이 Store는 Tick 이력이나 가격 crossing 범위를 보존하지 않는다.
별도 가격 REST Controller는 제공하지 않는다. Browser에는 아래 WebSocket으로 전달하고 주문은 서버 내부 가격을 사용한다.

### Redis 공유 가격과 이벤트

`LatestPriceStore`는 단일 노드의 빠른 서버 기준 가격 조회를 담당하고,
`RedisMarketDataBridge`는 최대 1,024건의 큐와 별도 Worker로 Redis를 갱신한다.
Binance 수신 Thread에서는 Redis나 Browser I/O를 수행하지 않는다.
현재는 이 노드 하나가 Binance 가격을 수집한다. 여러 수집 노드를 동시에 실행하기 전에는
수집 소유권과 가용 상태 변경의 책임을 별도로 설계해야 한다.

| Redis Key | 내용/수명 |
| --- | --- |
| `trading:market:v1:snapshot:{id}` | version=1 JSON, 내부 ID/Domain Mark Price/eventTime/receivedAt. 두 timestamp 기준 남은 freshness만큼, 최대 5초 TTL |
| `trading:market:v1:watermark:{id}` | 마지막 eventTime, 24시간 TTL. Snapshot 만료 후에도 중복/역순 갱신 차단 |
| `trading:market:v1:state:{id}` | FRESH 또는 RECONNECTING/UNAVAILABLE. 가격과 함께 원자적으로 조회하며 연결 중단 시 Snapshot 제거 |
| `trading:market:v1:events` | 모든 수락 가격과 연결 상태의 Redis Stream, 정확히 최대 100,000건 보관 |
| `trading:market:v1:fanout` | 같은 JSON 이벤트의 Pub/Sub Channel |

Lua 하나에서 시간 역행 검사, Snapshot 저장, Stream 추가와 Pub/Sub 발행을 수행한다.
큐에서 지연되어 freshness를 잃은 가격은 다시 5초를 부여하지 않고 폐기하며 replay gap으로 기록한다.
Pub/Sub를 실제 구독한 `MarketDataFanout`이 로컬 소비자에 전달한다. 같은 eventId의 로컬 fallback과
Pub/Sub echo는 최대 8,192개 ID의 중복 제거 구간에서 한 번만 전달한다.
Fanout 자체도 1,024건으로 제한되며 밀릴 때 오래된 UI 이벤트부터 버린다. 거래 Trigger는 이 경로에 의존하면 안 된다.

Redis 연결/명령 timeout은 1초이고 장애 시 5초 간격으로 재접속한다. 초기 Redis 연결 실패도
서버 기동을 종료시키지 않는다. 유휴 상태에서도 1초마다 연결과 구독 가용 상태를 확인한다.
Redis health(STARTING/HEALTHY/UNAVAILABLE)는 Binance 연결 상태 및 종목별 freshness와 별도다.
Redis 장애 시 현재 노드의 유효한 로컬 가격은 계속 조회할 수 있고 UI용 fanout은 로컬로 우회한다.
실패·큐 초과·폐기마다 `gapSequence`로 재생 경로의 불연속을 알리므로, Redis 복구만으로
누락된 가격 crossing을 복원했다고 판단하지 않는다. PostgreSQL 데이터는 변경하지 않는다.

Stream은 Pub/Sub와 달리 보존 구간을 다시 읽을 수 있지만 영구 원본은 아니다.
12개 종목의 1초 이벤트 기준 보존량은 약 2시간이며 실제 유입량에 따라 달라진다.
지정가/청산 Worker는 위의 PostgreSQL 체크포인트를 기준으로 Stream을 재생한다.
Redis Volume이나 이벤트의 영구 보존을 가정하지 않는다.

### Browser 실시간 가격 WebSocket

공개 endpoint는 `ws://localhost:8081/ws/market`이며 Raw WebSocket JSON을 사용한다.
STOMP/SockJS는 필요하지 않으므로 추가하지 않았다. Spring WebSocket Starter는 서버 측 Upgrade와
Session 처리를 제공한다. 기존 REST endpoint와 동일한 서버에서 동작한다.
Browser의 허용 Origin은 기본 `http://localhost:5173,http://127.0.0.1:5173`이며
`TRADING_WS_ALLOWED_ORIGINS`에 쉼표로 구분한 정확한 Origin을 지정할 수 있다. `*`는 허용하지 않는다.
TLS 배포에서는 `wss://`를 사용한다. 구독 ID는 `GET /api/v1/symbols`에서 얻으며 Provider Symbol은 전달하지 않는다.

Client → Server:

```json
{"type":"SUBSCRIBE","tradingSymbolIds":[1,2]}
{"type":"UNSUBSCRIBE","tradingSymbolIds":[2]}
{"type":"PING"}
```

Server → Client 예시(모든 응답 `version=1`):

```json
{"version":1,"type":"CONNECTED","maxSubscriptions":32,"heartbeatSeconds":20,"idleTimeoutSeconds":60}
{"version":1,"type":"SUBSCRIBED","tradingSymbolIds":[1,2]}
{"version":1,"type":"SNAPSHOT","prices":[{"tradingSymbolId":1,"price":"65123.45","status":"FRESH","eventTime":"2026-10-08T00:00:00Z","receivedAt":"2026-10-08T00:00:00.100Z"}]}
{"version":1,"type":"MARKET_PRICE","tradingSymbolId":1,"price":"65124.10","status":"FRESH","eventTime":"2026-10-08T00:00:01Z","receivedAt":"2026-10-08T00:00:01.100Z"}
{"version":1,"type":"MARKET_STATUS","status":"STALE","affectedTradingSymbolIds":[1]}
{"version":1,"type":"INFRA_STATUS","component":"REDIS","status":"HEALTHY"}
{"version":1,"type":"ERROR","code":"SYMBOL_NOT_AVAILABLE","message":"Every requested tradingSymbolId must be ACTIVE"}
{"version":1,"type":"UNSUBSCRIBED","tradingSymbolIds":[1]}
{"version":1,"type":"PONG","serverTime":"2026-10-08T00:00:20Z"}
```

연결만으로 모든 종목을 전송하지 않는다. 구독 요청 전체가 유효한 ACTIVE ID일 때만 반영하며
없는 ID·INACTIVE ID가 섞이면 요청 전체를 거절한다. 같은 ID를 다시 구독해도 중복 등록/전송하지 않는다.
SUBSCRIBED/UNSUBSCRIBED에는 처리 후 전체 구독 ID를 반환하고, SNAPSHOT에는 요청한 ID의 현재 상태를 반환한다.
수신 가격이 없으면 `price/eventTime/receivedAt=null, status=UNAVAILABLE`다.
금액은 JavaScript 부동소수점 손실을 피하도록 Decimal 문자열이며 Domain 자산 한 단위 기준 USDT다.

정상 실시간 전송은 Redis Pub/Sub → MarketDataFanout → 해당 종목 구독 Session 경로를 사용한다.
초기 Snapshot은 이 노드의 LatestPriceStore를 사용한다. 가격 eventTime을 비교하므로 Snapshot/실시간 경합이나
Pub/Sub 중복이 과거 가격을 덮어쓰지 않는다. Redis 장애 중 유효한 로컬 가격 전송은 유지하고
INFRA_STATUS는 UNAVAILABLE로 별도 표시한다. Redis 복구만으로 시장 가격이 RECOVERED가 되지는 않는다.

MARKET_STATUS는 `UNAVAILABLE`, `RECONNECTING`, `STALE`, `RECOVERED`다.
RECOVERED는 해당 종목의 새 유효 가격 이후에만 발생하며, 연결 성공 자체로 보내지 않는다.
1초 간격으로 종목별 timestamp를 확인하여 stale 전환을 알리고 오래된 값을 MARKET_PRICE로 반복 전송하지 않는다.
Frontend는 FRESH 외 상태에서 마지막 가격을 현재 거래 가능한 실시간 가격처럼 표시하면 안 된다.
INFRA_STATUS의 Redis 상태는 STARTING/HEALTHY/UNAVAILABLE이며 시장 freshness와 독립적이다.

Client는 20초마다 JSON PING을 보내고, 실제 Client 입력이 60초 동안 없으면 연결을 종료한다.
연결은 최대 256개, Session당 종목은 32개, 입력은 8KiB/초당 20개 명령으로 제한한다.
Session별 출력 큐는 128개이며 별도 8개 Writer Thread가 전송한다. 느린 Client는 큐 초과 또는
5초 전송 timeout 시 1013 코드로 종료하여 Binance/Redis 수신 Thread를 막지 않는다.
소켓 종료도 별도 큐에서 처리하며 Tomcat Close timeout은 1초다.
Client 종료/오류/서버 종료 시 구독과 큐를 정리한다. 재연결 후에는 필요한 ID를 다시 SUBSCRIBE한다.

React에서 사용할 기본 연결 예:

```javascript
const socket = new WebSocket('ws://localhost:8081/ws/market');
socket.onopen = () => socket.send(JSON.stringify({type: 'SUBSCRIBE', tradingSymbolIds: [selectedSymbolId]}));
socket.onmessage = ({data}) => handleMarketMessage(JSON.parse(data));
const heartbeat = setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: 'PING'}));
}, 20_000);
// useEffect cleanup:
// clearInterval(heartbeat); socket.close();
```

WebSocket은 REST가 아니므로 OpenAPI path에 중복 선언하지 않고 이 Protocol을 계약으로 관리한다.
실제 HTTP Upgrade, Redis 경유 live 전달, Origin 거절, 구독 검증/해제, stale/복구와
느린 소켓의 비동기 격리를 외부 Binance 없이 자동 테스트한다.

## 테스트와 OpenAPI 갱신

```powershell
.\gradlew.bat --no-daemon clean build
.\gradlew.bat test
```

macOS/Linux에서는 `sh ./gradlew`를 사용한다. 통합 테스트는 Docker에서 격리된 PostgreSQL과 Redis를
생성하고 종료 시 정리한다. 로컬/운영 DB 자격증명을 쓰지 않고 실제 Flyway와 Hibernate validate를 실행한다.
Docker가 없으면 실패하며 자동 생략하지 않는다. 최초 실행에는 이미지/의존성 다운로드가 필요하다.
**자동 테스트는 Binance 연결에 의존하지 않는다.**

DB 없이 웹/보안/오류 응답 테스트만 실행하려면:

```powershell
.\gradlew.bat test --tests '*TradingSymbolWebTests'
```

루트 `docs/trading-openapi.yaml`은 실제 로컬 endpoint에서 생성한다.
API 변경 후 서버를 실행하고 `trading-server`에서 아래 명령으로 갱신해 코드와 함께 리뷰한다.
별도 생성 플러그인이나 수작업으로 중복 관리하는 DTO 스키마는 사용하지 않는다.

```powershell
Invoke-WebRequest 'http://localhost:8081/v3/api-docs.yaml' -OutFile '../docs/trading-openapi.yaml'
```

OpenAPI 서버 URL은 `/`로 지정해 임시 포트/호스트가 명세에 들어가지 않게 했다.
자동 테스트가 실제 생성된 명세와 저장된 YAML을 비교하므로 API 변경 후 갱신을 빠뜨리면 실패한다.
설계/Provider Mapping은 `../docs/trading-symbols.md`를 참고한다.
JWT/Content 인증, Admin, Funding/수수료, Competition/Ranking과 다중 노드 조정은 구현하지 않았다.
