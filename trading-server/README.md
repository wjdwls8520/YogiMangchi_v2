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
사용자가 **게스트로 모의투자 시작**을 선택했을 때만 Frontend에서 위 POST를 호출한다. 같은 POST를 별도로
호출하면 각각 다른 Guest를 만든다. 페이지 진입·Symbol/Summary/Candle 조회·Mark/Order Book WebSocket 연결은
Guest를 만들지 않으며 credential 없이 사용할 수 있다. Wallet·Position·주문/취소/종료·거래 이력은 계속 Bearer 인증이 필요하다.
토큰을 잃거나 `expiresAt`(생성 후 정확히 7일)이 지나면 해당 계정에 다시 접근할 수 없다. 만료 credential은 401이며
자동 연장·Guest 자동 재생성을 하지 않는다. Frontend는 만료 시 명시적인 시작 동작을 다시 받아야 한다.
Frontend는 우선 메모리에 보관하고 새로고침 복구를 위한 브라우저 저장 선택에는 XSS 위험을 고려한다.
인터넷 공개 전에는 TLS, Gateway의 Guest 생성/인증 요청 제한과 최종 Content JWT 전환을 검증해야 한다.
계정 ID를 경로·요청에 넣어 다른 계정에 접근하는 API는 제공하지 않는다. 만료/변조/없는 Credential은 401이다.

#### 만료 Guest 정리와 이력 보존

`UnusedGuestCleanupService`는 **credential 만료 후 7일 유예**가 지난 미사용 Guest만 물리 정리한다.
거래한 적 없는 임시 계정의 DB 증가를 제한하기 위한 예외이며, 주문·체결·Position·재무 이력은 삭제하지 않는다.
정리 조건은 `guest_account=true`, 생성 후 재무 변경 없음, Order/Position Row 없음,
Wallet 초기 잔액 10,000 USDT·손익/사용/예약 Margin 모두 0이다. 유효 credential, 유예 기간,
일반 계정, 변경된 Wallet 또는 어떤 상태든 거래 이력이 있는 계정은 제외한다.
Open Position/Pending Order가 있는 만료 Guest는 기존 Trigger/청산 감시를 유지한다.
만료 자체를 이유로 강제 체결·취소·잔액 초기화를 하지 않으며 별도의 EXPIRED 상태도 추가하지 않는다.

별도 scheduler가 시작 1분 후, 이후 1시간 간격으로 최대 100개를 처리한다.
`TRADING_GUEST_CLEANUP_ENABLED=false`로 중지할 수 있다. V9의 미사용 Guest 만료 partial index와
Order/Position 계정 인덱스로 대상을 제한하며 `FOR UPDATE SKIP LOCKED`로 사용 중인 계정을 건너뛴다.
Trading과 같은 Account Row를 먼저 잠그고 Wallet → Account 순으로 한 Transaction에서 삭제한다.
FK/DB 오류는 배치 전체를 Rollback하고 다음 실행에 재시도한다. 가격 수신/Trigger 스레드 및 Redis를 사용하지 않는다.

V9는 기존 V1~V8의 Guest만 표시하며 향후 일반 계정의 DB 기본값은 `guest_account=false`다.
금융 원장은 계속 PostgreSQL이 원본이고 Redis/Browser Storage로 이전하지 않는다. Browser에 복구용 credential을
보관하더라도 잔액·Position·Order의 원본으로 신뢰하지 않는다.
**거래 이력이 있는 만료 Guest의 영구 보존량까지 줄이는 정책은 이번 정리에 포함하지 않는다.**
해당 이력을 삭제/아카이브하려면 별도의 보존 기간과 운영 정책을 먼저 결정해야 한다.

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
Client의 임의 가격은 사용하지 않는다. 계정별 Key UNIQUE, 계정·종목·방향별 활성 Position UNIQUE, Position별 LIQUIDATE UNIQUE,
Fill의 order_id UNIQUE와 계정 Row Lock을 함께 사용한다. Position/Wallet/Order/Fill은 하나의 Transaction이다.
Commit 이후에만 성공 로그를 남긴다. Lock timeout/교착은 전체 rollback하며 무한 재시도하지 않는다.
신규 주문에는 ACTIVE 종목과 보유 종목 전체의 fresh 가격, 충분한 가용 Margin이 필요하다.
종료도 전체 fresh 평가를 요구하며 유지증거금 이하의 계정은 `ACCOUNT_AT_RISK`로 차단한다.
손실 Position 종료로 현금이 음수가 되면 거절한다. 수익 Position을 먼저 종료해야 하는 경우가 있다.
가격이 새로 도착했지만 위험 처리가 끝나지 않았으면 503 `ENGINE_RECOVERING`이다. 동일 Key로 짧은 간격을 두고 재시도한다.
단순 READY 상태도 개별 종목의 freshness 또는 주문 허용을 보장하지 않는다.

### Hedge Mode 통합 Position 및 종목별 Leverage

Hedge Mode만 지원한다. `(accountId, tradingSymbolId, side)`별 OPEN Position은 최대 하나이며,
LONG/SHORT은 동시에 보유할 수 있다. 반대 방향 OPEN은 기존 노출을 상계하지 않는다.
MARKET/LIMIT OPEN 체결은 같은 `HedgePositions` 경로에서 기존 Position ID를 유지하고 수량과 진입 원가를 더한다.
Order/Fill은 매 체결마다 별개로 남는다. 수량이 0이 된 생애주기는 CLOSED/LIQUIDATED로 보존하고, 재진입하면 새 ID를 만든다.

| Method | Path | 계약 |
| --- | --- | --- |
| GET | `/api/v1/trading/account/symbols/{symbolId}/leverage` | Bearer 계정의 종목 설정. 미설정이면 10배, `updatedAt=null`. 조회로 DB Row를 만들지 않음 |
| PUT | 동일 경로 | `{"leverage":14}`. 정수 1~100. 두 방향 Position과 PENDING OPEN 예약을 원자적으로 재계산 |

응답 예: `{"tradingSymbolId":1,"leverage":14,"maxLeverage":100,"marginMode":"CROSS","updatedAt":"2026-10-19T00:00:00Z"}`.
설정은 PostgreSQL `symbol_leverage`에 저장하며 LONG/SHORT이 공유한다. ETH 등 다른 종목에는 영향을 주지 않는다.
Frontend는 종목 선택 시 GET으로 복구하고, 변경 시 PUT 성공 후 그 값으로 OPEN을 보낸다.
OPEN의 기존 `leverage` 입력은 유지하지만 서버 설정과 다르면 409 `LEVERAGE_MISMATCH`다.
주문만으로 설정을 변경하지 않는다. 잘못된 범위는 `INVALID_LEVERAGE`(400), 비정수 JSON은 400이다.
미존재/INACTIVE 종목은 `SYMBOL_NOT_AVAILABLE`(409), 미인증/만료는 401이다.

레버리지 변경은 기존 Account DB Lock과 Transaction 안에서 남은 진입 원가 / 새 leverage로 두 방향 Margin을 계산한다.
해당 종목 PENDING OPEN의 예약도 limitPrice * quantity / 새 leverage로 다시 계산한다.
Wallet Used/Reserved의 전체 증감이 `min(balance,equity)`를 초과하면 `INSUFFICIENT_MARGIN`(409)로 전부 rollback한다.
노출/예약이 있으면 전체 보유 종목의 fresh 가격과 위험 평가·Engine Gate를 확인한다.
`PRICE_NOT_FRESH`/`ENGINE_RECOVERING`(503), `ACCOUNT_AT_RISK`(409)도 원자적으로 실패한다.
동일 값 반복 PUT은 재무 변경을 반복하지 않는다. 수량·Entry·실현 PnL·CLOSE 예약은 바꾸지 않는다.
`OrderResponse.requestedLeverage`는 최초 요청 값이고, `leverage`는 PENDING OPEN의 유효 값 또는 FILLED 시점 값이다.
이미 완료된 Order/Fill의 기록을 현재 설정에 맞춰 다시 쓰지 않는다. CLOSE는 실제 체결 당시 Position leverage를 기록한다.

Position의 `entry_notional NUMERIC(66,26)`은 남은 진입 원가다. 가격 18자리 × 수량 8자리 곱을 정확히 누적하고,
표시용 `entryPrice`만 원가 / 현재 수량을 HALF_EVEN 18자리로 산출한다. PnL은 반올림된 표시 평균 대신 원가를 사용한다.
부분 종료에서는 원가를 수량 비례 HALF_EVEN 26자리로 배분하고 마지막 종료에서 잔여 전부를 정산한다.
PnL의 금융 원장 반영은 기존 HALF_EVEN 18자리다. Fill 단위의 최하위 자리 반올림은 존재하나 평균가 재사용으로 오차를 누적하지 않는다.
`initialQuantity`는 생애주기의 누적 진입 수량, `initialMargin`은 진입 시 반영한 Margin 증가분의 누적값이다.
현재 Margin과 비교하는 상한이 아니며 레버리지 변경 자체는 이 이력을 바꾸지 않는다. `exitPrice`는 최종 종료 Fill 가격이다.
추가 진입은 이전 실현 PnL과 CLOSE 예약을 보존하며, 손익을 Wallet Balance에 임의 정산하지 않는다.
Gross 유지증거금은 LONG/SHORT 각각 Mark Notional의 0.5%를 합산한다. 100배에서도 노출/예약을 상계하지 않는다.
Binance 리스크 Tier, 수수료/Funding, 호가 기반 체결·슬리피지·부분 Fill은 도입하지 않는다.

#### 조건부 강제청산 예상가 조회

`GET /api/v1/trading/account/summary`의 각 Position과 `GET /api/v1/trading/account/positions`는
같은 `liquidationPrice`, `liquidationPriceStatus`, `liquidationPriceAsOf`를 제공한다. 기존 Guest Bearer 인증을 유지한다.
이는 **다른 보유 종목의 Mark를 현재 Snapshot에 고정하고, 대상 종목 Mark만 변화시켰을 때의 첫 계정 위험 임계가격**이다.
대상 종목의 LONG/SHORT에는 같은 가격 변화를 동시에 적용하며 두 행에 같은 결과가 나온다.
개별 Position만 따로 청산하는 가격이나 실제 LIQUIDATE Fill 가격을 보장하지 않는다.
중간 가격에서 주문이 체결되거나 다른 종목 가격·자산·포지션이 바뀌면 조건과 예상가도 바뀐다. 미래 주문 체결 경로는 예측하지 않는다.

`AccountValuation.risk()`를 실제 엔진과 경계 검증에서 공유한다.
각 Position PnL은 `방향 부호 * (Mark * 남은 수량 - 남은 진입 원가)`를 HALF_EVEN 18자리로 산출한다.
계정 Equity는 `Wallet Balance + 모든 PnL`, 유지증거금은 각 방향의 `Mark * 수량 * 0.005`를 CEILING 18자리로 합산한다.
`Equity <= 유지증거금`이면 계정이 위험 상태다. Hedge의 순노출이 0이어도 Gross 유지증거금은 0이 아니다.
현재 모델에서 Used/Reserved Margin·CLOSE 예약·leverage 자체는 이 위험 공식의 항이 아니다.
따라서 레버리지·예약만 변경하고 자산·노출·Mark가 같다면 예상가도 유지된다.

| liquidationPriceStatus | liquidationPrice / 의미 |
| --- | --- |
| ESTIMATED_DOWNWARD | 양수 decimal string. 이 종목 Mark 하락 방향의 첫 계정 위험 가격 |
| ESTIMATED_UPWARD | 양수 decimal string. 이 종목 Mark 상승 방향의 첫 계정 위험 가격. LONG 행에서도 가능 |
| PRICE_UNAVAILABLE | null. 보유 종목 중 하나라도 시세 누락·만료·연결 불가 |
| NO_THRESHOLD | null. 다른 Mark 고정 가정과 지원하는 양수 가격 범위 안에서 유효 경계가 없음 |
| UNSUPPORTED_MODEL | null. 정밀도/가격 범위, 현재점의 반올림 모호성 또는 탐색 한도 때문에 경계를 증명할 수 없음 |
| ALREADY_AT_RISK | null. 현재 Snapshot에서 이미 Equity가 유지증거금 이하 |

`liquidationPriceAsOf`는 **필요한 모든 보유 종목의 서버 receivedAt 중 가장 오래된 시각**이다.
Provider eventTime이나 실제 체결 예정 시각이 아니다. PRICE_UNAVAILABLE이면 시각도 null이고 오래된 예상가는 재사용하지 않는다.
계정 금융 상태의 조회 시점은 기존 Summary `capturedAt`이다.

반올림 전 선형식은 오차 한계 내 후보 구간을 좁히는 데만 사용한다. 최종 숫자는 엔진의 PnL/유지증거금 반올림으로 검증한다.
HALF_EVEN/CEILING으로 생길 수 있는 미세한 위험 구간을 단조 이진 탐색으로 건너뛰지 않도록 구간 상·하한을 검사한다.
반환값은 가격 10^-18 단위에서 위험 조건을 만족하고, 현재 가격 쪽의 바로 이웃 가격은 안전함을 확인한다.
종목당 최대 512개/계정 조회당 최대 4096개 구간을 검사하며 증명에 실패하면 UNSUPPORTED_MODEL이다.
종목별 결과를 한 번만 계산해 양방향 행에서 공유한다. 새 SQL·외부 호출·DB 쓰기를 추가하지 않으며
기존 Account Lock과 한 번의 시세 Snapshot을 재사용한다. Wallet 단독 조회는 예상가 탐색을 하지 않는다.

예: 현금 10,000 USDT, 단일 LONG 수량 100, 진입 원가 100,000, 현재 Mark 1,000인 Snapshot의 Position 일부:

```json
{
  "id": 101,
  "tradingSymbolId": 1,
  "side": "LONG",
  "liquidationPrice": "904.522613065326633165",
  "liquidationPriceStatus": "ESTIMATED_DOWNWARD",
  "liquidationPriceAsOf": "2026-10-19T12:00:00Z"
}
```

Frontend는 값을 계산하지 않고 서버 decimal string을 표시한다. null은 `—`로 표시하고 상태에 따른 사유를 제공한다.
표시 이름과 도움말에는 조건부 **계정 강제청산 예상가**이며 실제 체결가 보장이 아님을 명시한다.
방향은 Position side에서 추정하지 말고 status로 판단한다. 새 알림 서버나 WebSocket 채널은 추가하지 않는다.

#### V10 데이터 이관 및 배포 주의

**백업 후 모든 구버전 Trading 프로세스와 Worker를 중지한 상태에서 Migration한다. 혼합 버전 실행과 무중단 Rolling 배포를 지원하지 않는다.**
V10은 기존 Migration을 수정하지 않으며 PostgreSQL Transaction과 대상 테이블 잠금으로 원자적으로 변환한다.
Wallet Used/Reserved와 실제 노출/예약, CLOSE 예약이 불일치하거나 합산 노출이 허용 범위를 넘으면 전체 실패한다.
이 경우 원장 조사·명시적인 위험 축소 후 재시도해야 하며, Migration이 데이터를 임의 삭제하거나 지갑을 초기화하지 않는다.
계정·종목의 기존 OPEN/PENDING OPEN leverage 최댓값을 공유 설정으로 선택한다. 추가 이관 자금을 요구하지 않는 정책이다.
같은 방향 OPEN 중 가장 작은 ID를 유지하고 남은 원가·수량·실현 PnL·CLOSE 예약을 합산한다.
다른 원본 Position은 `MERGED`와 `mergedIntoPositionId`로 연결한 과거 스냅샷으로 보존하며 활성 평가에서는 제외한다.
기존 CLOSED/LIQUIDATED 및 완료 Order/Fill의 원래 참조는 보존한다. PENDING CLOSE만 살아남은 ID로 옮기고
`originalPositionId`에 원래 대상을 남긴다. Wallet Used/Reserved만 새 합계로 조정하고 Balance/실현 PnL은 유지한다.
Preference인 symbol_leverage만 계정 삭제 시 CASCADE한다. 만료 미사용 Guest 정리를 위한 것으로 금융 이력에는 CASCADE를 적용하지 않는다.
테스트는 격리된 PostgreSQL/Redis에서 이관·rollback을 확인한다. 실제 사용자 로컬/운영 DB 이관은 자동 실행하지 않는다.

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
새 지정가는 주문 Transaction에서 계정 잠금 후 fresh Mark를 기준으로 passive 여부를 검증한다.
OPEN LONG(BUY)은 `limitPrice < Mark`, OPEN SHORT(SELL)은 `limitPrice > Mark`만 허용한다.
CLOSE LONG(SELL)은 `limitPrice > Mark`, CLOSE SHORT(BUY)은 `limitPrice < Mark`만 허용한다.
같은 가격도 거절하며 HTTP 409 `MARKETABLE_LIMIT_NOT_ALLOWED`를 반환한다. 오래된 Mark는 기존대로
503 `PRICE_NOT_FRESH`다. 이미 수락한 동일 Idempotency-Key 재전송은 Mark 변화와 무관하게 기존 결과를 반환한다.
LIMIT 필요 증거금은 계속 `limitPrice * quantity / leverage`이며 Mark 변화만으로 달라지지 않는다.
다른 주문·Position·예약으로 사용 가능 잔액이 바뀌면 `INSUFFICIENT_MARGIN`으로 거절할 수 있다.
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
금액/PnL HALF_EVEN 18자리, Margin CEILING 18자리, Leverage 1~100, 새 주문 1~1,000,000 USDT Notional,
최대 10^12 현재 수량/100개 OPEN Position 정책을 정의한다. 통합된 한 방향의 남은 진입 원가도 1,000,000 USDT 이하여야 한다.
JSON 금액·수량은 정밀도를 보존하는 문자열이다.
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
`wss://fstream.binance.com/market/stream?streams=<providerSymbol 소문자>@markPrice@1s/<providerSymbol 소문자>@ticker/...`를 사용한다.
종목마다 Mark와 Ticker 두 Stream을 구독하므로 연결당 최대 512종목(1024 Stream)이다.
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
5초마다 확인해 마지막 정상 Mark Price 수신 후 15초 이상 침묵하면 재연결한다.
Ticker 수신은 Mark Price의 정상 상태나 재연결 횟수를 갱신하지 않는다.
이는 연결 전체의 수신 중단 감지이며 아래 종목별 freshness와 별개다.
24시간 연결 제한에 대비해 23시간 50분에 연결을 교체한다. Java WebSocket의 자동 Pong을 사용한다.
종료 시 재시도를 취소하고 Close를 전송하며, 응답을 최대 2초 기다린 후 연결을 정리한다.

기준 문서: [Binance 연결 정책](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect),
[Mark Price Stream](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market),
[Java 17 자동 Pong](https://docs.oracle.com/en/java/javase/17/docs/api/java.net.http/java/net/http/WebSocket.Listener.html#onPing(java.net.http.WebSocket,java.nio.ByteBuffer)).

### 24h Ticker 수집

동일한 연결에서 공식 USDⓈ-M Futures `<symbol>@ticker`를 구독한다. 갱신 주기는 2초이며
통계는 UTC 일봉이 아닌 이동하는 24시간 구간이다.
`P`는 가격 변동률, `h/l`은 High/Low, `q`는 Quote Asset 거래대금이다.
High/Low만 DB `provider_unit_multiplier`로 정확히 나누고 변동률과 USDT 거래대금은 변환하지 않는다.
내부 ID 기준의 `marketdata.ticker.MarketTicker`를 사용하고 Provider 이름을 공유 데이터에 넣지 않는다.

`RedisTickerStore`는 256개 제한 큐와 별도 작업 스레드로 최신 통계만 저장한다.
큐가 가득 차면 오래된 대기 값을 버리고 다음 최신 이벤트를 받는다. Redis 실패 시 대기 데이터를
버리고 5초 후 재시도하며, Binance callback은 Redis 연결/명령을 기다리지 않는다.
기존 Mark의 Stream·Pub/Sub·Trigger 상태에 Ticker를 섞지 않는다.

- 최신값: `trading:market:v1:ticker:<tradingSymbolId>`
- 역순 방지: `trading:market:v1:ticker-watermark:<tradingSymbolId>` (24시간)
- freshness/TTL: 10초. Redis 서버 시각과 `min(eventTime, receivedAt)` 기준의 남은 시간만 부여한다.
- 미래 시각 허용 오차: 최대 1초. 중복/역순 이벤트는 Lua에서 원자적으로 거절한다.
- TTL 만료 이후에도 watermark가 남으므로 오래된 이벤트가 값을 되살리지 못한다.

공식 데이터 정의: [Binance Individual Symbol Ticker Streams](https://developers.binance.info/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market).
DB 대상은 기존 Mark와 함께 시작/재연결 시 갱신한다. 운영 중 활성 상태 변경의 즉시 구독 반영은
향후 Admin 정책에서 다루며, 일반 조회는 요청마다 현재 ACTIVE 목록을 사용한다.

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
- FRESH: 현재 구독에서 정상 수신했고 receivedAt 기준 5초 미만이며 허용 가능한 Provider 시각 차이
- STALE: 수신 후 5초 이상 지남
- UNAVAILABLE: 연결 중단/재구독 대기 또는 과도한 Clock Skew로 종목의 가격 사용 중단

Mark freshness는 `receivedAt`으로 판단하고 `eventTime`은 원본 Provider 시각과 중복·역순 판단에 유지한다.
`eventTime - receivedAt`의 절댓값이 1초 이하면 NORMAL, 1초 초과~5초는 WARNING,
5초 초과~10초는 DEGRADED이며 최근 수신한 가격을 사용할 수 있다. 10초 초과는 REJECTED로 거부하고
해당 종목에 UNAVAILABLE을 한 번 전달한다. 거부된 미래 timestamp는 watermark를 갱신하지 않는다.
수신 시각 자체가 서버 now보다 1초 넘게 미래이거나 이미 5초 이상 지난 데이터는 사용할 수 없다.
`[Market clock]`은 종목별 상태 전환과 같은 이상 상태의 30초 요약만 기록하며 Provider/내부 ID,
eventTime/receivedAt/serverNow, signed skewMs와 각 임계값을 포함한다.
`GET /api/v1/trading/status`의 `marketClockStatus/clockSkewMs`는 해당 수신 노드에서 최근 관찰한 가장
심한 Clock 상태다. 데이터가 없으면 UNAVAILABLE/null이며 기존 READY/RECOVERING과 독립적인 운영 정보다.
이 보호 장치는 NTP/AWS Amazon Time Sync를 대체하지 않는다. 운영 시 모든 앱·Redis 노드의 OS 시간 동기화가 필요하다.
오래된/과도한 시각 차이의 메시지, 중복·역순 eventTime, 잘못된 payload는 저장값을 갱신하지 않는다.
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
| `trading:market:v1:snapshot:{id}` | version=1 JSON, 내부 ID/Domain Mark Price/eventTime/receivedAt. receivedAt 기준 남은 freshness만큼, 최대 5초 TTL |
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

### 참고용 Order Book

Order Book은 Binance 실제 시장의 호가를 보여주는 참고 정보다. Yogimangchi 사용자의 주문장이 아니며
체결 가격·가능 수량·부분체결·강제청산 판단에는 사용하지 않는다. 기존 Mark Price Trigger를 유지한다.

`BinanceOrderBookClient`는 DB의 ACTIVE Binance mapping을 재사용하고, 별도의 단일 Combined WebSocket에서
`<providerSymbol 소문자>@depth20@500ms`를 구독한다. 경로는
`wss://fstream.binance.com/public/stream?streams=...`다.
[공식 USD-M Partial Book Depth 계약](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public#partial-book-depth-streams)에
따라 Bid/Ask 각각 최대 20 level의 전체 Snapshot을 교체하므로 diff 복원이나 HTTP 초기 조회가 필요 없다.
DB mapping의 `provider_unit_multiplier`로 가격은 나누고 수량은 곱한다.
예를 들어 multiplier=1000인 PEPE의 Provider 가격 `0.004001`, 수량 `1.25`는 Domain 가격 `0.000004001`, 수량 `1250`이다.
Provider Symbol 문자열에서 단위를 추측하지 않는다.

| Redis Key | 내용/수명 |
| --- | --- |
| `trading:market:v1:orderbook:<id>` | 종목별 최신 Snapshot 하나. receivedAt 기준 남은 TTL 최대 3초 |
| `trading:market:v1:orderbook-watermark:<id>` | 마지막 Provider update ID/eventTime만 24시간 보관하여 Snapshot 만료 후에도 역순·중복 차단 |
| `trading:market:v1:orderbook:fanout` | 갱신한 Snapshot의 Pub/Sub channel. 메시지 이력 저장 없음 |

Snapshot은 `tradingSymbolId`, `bids`, `asks`, 내부 `providerUpdateId`, `eventTime`, `receivedAt`을 가진다.
Lua로 update ID 증가와 eventTime 비퇴행을 확인하고 Snapshot 교체·TTL·Pub/Sub을 원자적으로 수행한다.
Order Book을 Redis Stream 또는 PostgreSQL에 누적하지 않는다. watermark는 과거 호가가 아닌 최신 순서 정보다.
수신 후 3초가 지나면 stale이며, 수신 시 이미 3초 이상 늦은 이벤트도 버린다.
Provider eventTime이 수신 시각보다 최대 10초 빠른 경우만 허용하되 TTL은 늘리지 않는다. 앱·Redis의 시각 동기화가 필요하다.

기본 수집은 활성화되어 있다. 여러 Backend node 배포 시 수집자 한 곳만 활성화하고 나머지는
`BINANCE_ORDER_BOOK_ENABLED=false`로 실행한다. 각 노드는 Redis Pub/Sub으로 동일한 Snapshot을 전달한다.
Leader Election은 추가하지 않는다. 재연결 시 DB mapping을 다시 읽으며 지수 backoff/jitter,
429/418 대기, 15초 무수신 재연결, 23시간 50분 연결 교체와 종료 처리를 갖는다.
Redis 쓰기 큐와 Pub/Sub 전달 큐는 각각 128건으로 제한하며 지연된 참고 데이터를 버린다.
Redis 실패는 5초 후 재시도한다. Order Book 연결·큐·작업 스레드는 Mark Price 경로와 독립적이므로
호가 장애가 Trading gate나 Mark Price/Trigger/Candle/Summary를 중단시키지 않는다.

기존 `/ws/market`의 SUBSCRIBE 대상에 다음 `ORDER_BOOK` 메시지를 추가한다. fresh Redis Snapshot이 있으면
구독 직후 즉시 전달하고 이후 선택한 종목만 갱신한다. 금융 값은 Domain 단위 decimal string이다.

```json
{"version":1,"type":"ORDER_BOOK","tradingSymbolId":11,"status":"FRESH","bids":[{"price":"0.000004001","quantity":"1250"}],"asks":[{"price":"0.000004002","quantity":"2500"}],"eventTime":"2026-10-16T00:00:00Z","receivedAt":"2026-10-16T00:00:00.100Z"}
{"version":1,"type":"ORDER_BOOK","tradingSymbolId":11,"status":"STALE","bids":[],"asks":[],"eventTime":null,"receivedAt":null}
```

최초 Snapshot이 없으면 `UNAVAILABLE`이며 빈 배열/null 시각을 반환한다. 1초 간격 watchdog은 만료 후
`STALE`을 보내 표시할 호가를 비운다. 새 fresh Snapshot이 오면 `FRESH`로 복구한다.
Provider Symbol, multiplier, update ID는 Browser 계약에 노출하지 않는다. Mark의 `MARKET_STATUS`와 독립된 상태다.
Frontend는 `ORDER_BOOK`을 처리하고 FRESH 외 상태에서 기존 호가를 비워야 한다. 호가 선택은 지정가 입력 편의이며
최종 passive/증거금 검증은 Backend가 수행한다.

## Market Summary 조회

인증 없이 `GET /api/v1/market/tickers`를 호출하면 DB의 ACTIVE 종목 전체를 Symbol 순서로 반환한다.
PostgreSQL 조회 Transaction 종료 후 공유 Redis의 Mark snapshot/state와 Ticker snapshot을 하나의
MGET으로 읽는다. JVM `LatestPriceStore`를 조회하거나 Ticker의 Last Price로 Mark를 대체하지 않는다.
이 API는 표시/정렬용이며 주문·청산의 가격 정책을 변경하지 않는다.

```json
[
  {
    "tradingSymbolId": 1,
    "symbol": "BTC",
    "quoteAsset": "USDT",
    "markPrice": "114230.10000000",
    "changePercent24h": "2.37",
    "highPrice24h": "115100.00",
    "lowPrice24h": "109800.00",
    "quoteVolume24h": "1234567890.12",
    "status": "FRESH",
    "updatedAt": "2026-10-13T09:00:00Z"
  }
]
```

금융 값은 정확한 decimal string이다. Mark freshness는 기존 5초, 통계 freshness는 10초이며
응답 시 Mark의 수신 freshness와 Clock Skew, 통계의 timestamp를 다시 검증한다. `FRESH`는 둘 다 최신인 경우다.
읽힌 데이터가 시각 범위를 벗어나면 `STALE`, 일부 누락/잘못된 payload/연결 상태 불가/Redis 실패는
`UNAVAILABLE`이다. 만료된 값은 null로 숨기며 남아 있는 유효 값만 제공한다.
TTL 만료로 snapshot 자체가 사라진 경우에는 누락이므로 `UNAVAILABLE`이다.
Redis 장애에서도 현재 ACTIVE 목록과 null 필드를 HTTP 200으로 반환한다.
DB 조회 자체가 실패한 경우에는 기존 전역 서버 오류 정책을 따른다.
`updatedAt`은 반환한 유효 데이터 중 가장 오래된 Provider eventTime(ISO-8601 UTC), 유효 값이 없으면 null이다.
한 종목의 누락/손상 때문에 다른 종목의 유효 값을 버리지 않는다.

## Historical Mark Price Candle

Public `GET /api/v1/market/candles?tradingSymbolId=1&interval=1m&limit=300`은 최근 Mark Price 봉을
openTime 오름차순으로 반환한다. 지원 interval은 `1m/3m/5m/15m/30m/1h/4h/12h/24h`,
limit은 1~500(기본 300)이다. `24h`는 Provider `1d`로 매핑하며 `10m`과 API 입력 `1d`는 지원하지 않는다.
선택 query `before`가 없으면 기존 latest page다. `&before=2026-10-15T10:00:00Z`를 추가하면
해당 시각보다 `openTime`이 작은 과거 봉을 반환한다. 응답의 첫 번째(가장 오래된) `openTime`을 다음
`before`로 전달해 과거 방향으로 반복 조회하며 빈 배열이면 더 이전 데이터가 없다. 응답 배열/필드는 동일하다.
`before`는 Epoch 이후 현재 이하의 ISO-8601 시각이며 최대 millisecond 정밀도다. 빈 값·잘못된 형식·미래는 400이다.
Provider 내부에서는 `endTime=before-1ms`를 사용하고 응답 경계도 다시 확인한다. 과거 page는 진행 중인 봉을 제외한다.
Source는 [공식 Binance USD-M Mark Price Kline](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)의
`GET https://fapi.binance.com/fapi/v1/markPriceKlines`이다. Browser는 Trading Server만 호출한다.
DB의 ACTIVE/BINANCE Mapping과 계약 배수를 사용해 모든 OHLC를 Domain 단위로 정확히 나눈다.
응답은 `openTime/closeTime`(ISO-8601 UTC), `open/high/low/close`(decimal string)이다.
시간은 Provider bucket 경계를 보존하며 `closeTime`은 종료 경계의 마지막 millisecond다.
마지막 봉은 진행 중일 수 있고 `close`는 그때까지의 값이다. Frontend는 `openTime`을 고유 키로 사용해
`/ws/market` 가격을 같은 UTC bucket에 반영한다. 24h 봉은 UTC 자정 시작이며 빈 구간을 가짜 봉으로 채우지 않는다.

Redis `trading:market:v1:candles:<id>:<interval>:<providerSymbol>:<multiplier>:latest` 또는
동일 prefix의 `:before:<epochMillis>`에 최대 500봉을 15초 캐시하고
limit에 맞는 최신 구간만 반환한다. Provider 대기 시간은 남은 TTL에서 제외하며 오류 응답은 캐시하지 않는다.
서로 다른 cursor는 캐시/동시 조회를 공유하지 않고 동일 cursor의 limit만 다른 요청은 공유한다.
종료된 과거 page도 동일한 짧은 TTL을 사용하며 빈 page도 캐시한다. 영구 Historical DB/Redis 누적 저장은 하지 않는다.
진행 중인 마지막 봉의 cache TTL은 bucket 종료까지만 부여하고, 다음 bucket에서 해당 중간 결과를 재사용하지 않는다.
Mapping 변경은 다른 키를 사용하고 캐시 hit에서도 현재 DB의 ACTIVE 상태를 확인한다.
동일 노드의 동시 cache miss는 한 요청으로 합친다. 다중 노드는 Redis 캐시를 공유하며 분산 Lock은 사용하지 않는다.
Provider 연결 2초/전체 응답 4초 timeout, 동시 Provider 호출 4개/전체 Candle 요청 32개 제한을 사용한다.
429/418은 Retry-After 기반으로 최소 60초, 일반 Provider 실패/timeout은 2초 동안 후속 호출을 쉬며 자동 재시도하지 않는다.
잘못된 query는 400, 없는 ID는 404, INACTIVE는 409, Provider 오류는 502, timeout은 504다.
Mapping·Redis 불가 또는 용량/rate limit은 Candle 조회에만 503을 반환한다. 유효한 조회 결과의 캐시 쓰기만
실패하면 해당 응답은 제공한다. 이 조회 경로는 Trading 가격·Gate·Stream·Trigger·Browser WS 상태를 변경하지 않는다.
DB 조회 Transaction은 Redis/외부 HTTP 호출 전에 종료한다. 별도 DB 저장·새 Dependency는 없다.

## 테스트와 Runtime OpenAPI

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

Runtime Springdoc `/v3/api-docs`가 현재 API 계약의 원본이다. 정적 YAML을 중복 생성/갱신하지 않는다.
OpenAPI 서버 URL은 `/`로 지정해 임시 포트/호스트가 명세에 들어가지 않게 했다.
자동 테스트는 Runtime 명세에서 기존 Trading API, 인증 경계와 Market Summary 필드/타입을 검증한다.
루트의 기존 `docs/trading-openapi.yaml`은 과거 Snapshot이며 최신 계약 확인에는 Runtime 문서를 사용한다.
설계/Provider Mapping은 `../docs/trading-symbols.md`를 참고한다.
JWT/Content 인증, Admin, Funding/수수료, Competition/Ranking과 다중 노드 조정은 구현하지 않았다.
