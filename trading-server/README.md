# Trading Server

Yogimangchi V2의 독립 Spring Boot 애플리케이션이다. 현재 PostgreSQL/JPA 기반
TradingSymbol 구조, 공개 거래 종목 조회 API, Binance Mark Price 수신과 정규화된 최신 가격 상태를 제공한다. 루트 `readme.md`,
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
| `postgresql` (runtime) | PostgreSQL JDBC 연결 |
| `flyway-core`, `flyway-database-postgresql` (DB 모듈은 runtime) | SQL 마이그레이션과 Seed 이력 |
| `springdoc-openapi-starter-webmvc-ui` | Swagger와 OpenAPI 생성 |
| `spring-boot-starter-test`, `spring-security-test` | JUnit, MockMvc, 보안/오류 테스트 |
| `spring-boot-testcontainers`, `org.testcontainers:postgresql` | 실제 PostgreSQL 통합 테스트 |
| `junit-platform-launcher` (test runtime) | Gradle 테스트 실행 |

Boot 4의 `starter-webmvc`, `starter-webmvc-test`, `starter-security-test`를 교체했다.
`UserDetailsServiceAutoConfiguration`과 `AutoConfigureMockMvc` import도 Boot 3용으로 변경했다.
Gradle `platform`으로 Boot BOM을 사용하며 별도의 dependency-management 플러그인은 없다.
Redis, Validation, Lombok, JWT/OAuth2, H2, WebSocket 의존성은 아직 필요하지 않아 추가하지 않았다.

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

Security는 이 경로의 GET만 추가 공개한다. 하위 경로, 쓰기 요청, 다른 업무 API는 차단한다.
로컬 문서 접근과 기본 계정 미생성, 폼 로그인/Basic/로그아웃/요청 캐시 비활성화,
CSRF 기본 보호를 유지했다. JWT/세션/토큰 저장 정책은 아직 구현·결정하지 않았다.
CORS는 실제 Frontend Origin이 정해질 때 명시적으로 허용 목록을 정한다.

현재 업무 예외가 없어 BusinessException/ErrorCode를 미리 만들지 않았다.
전역 `ApiExceptionHandler`는 MVC 오류 처리를 유지하고 예상하지 못한 오류를
`application/problem+json`의 500 응답으로 반환한다. 내부 예외/SQL/Stack Trace는 응답에 넣지 않고
원인은 서버 로그에 남긴다. Service에서 예외를 삼키지 않는다.

## Binance Mark Price 수신

서버 준비 완료 후 DB의 ACTIVE/BINANCE 종목을 조회해 하나의 USDⓈ-M Futures Combined Stream에 연결한다.
`wss://fstream.binance.com/market/stream?streams=<providerSymbol 소문자>@markPrice@1s/...`를 사용한다.
API Key와 추가 의존성 없이 Java 17 기본 WebSocket을 사용하며, 재연결 시 DB 대상을 다시 조회한다.
현재 연결 도중 DB 변경을 즉시 반영하는 Admin/동적 구독 기능은 구현하지 않았다.

`[Binance WS]` 로그로 연결 상태와 10초 단위 수신 통계를 확인한다.
`[MARK PRICE]`에는 내부 ID, Domain Symbol, Provider Symbol, `providerMarkPrice`, `domainMarkPrice`,
Binance eventTime, 서버 receivedAt이 기록된다. 가격을 DB나 Redis에 저장하거나 Browser로 전송하지 않는다.
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
가격 조회 Controller, Browser WebSocket, Redis, 주문/체결 기능은 추가하지 않았다.

## 테스트와 OpenAPI 갱신

```powershell
.\gradlew.bat --no-daemon clean build
.\gradlew.bat test
```

macOS/Linux에서는 `sh ./gradlew`를 사용한다. 통합 테스트는 Docker에서 격리된 PostgreSQL을
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
Order/Fill/Position/Wallet, Redis 연동, JWT, Admin, Trading Engine은 이번 구현에 없다.
