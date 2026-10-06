# Trading Server

Yogimangchi V2의 독립 Spring Boot 애플리케이션이다. 현재 PostgreSQL/JPA 기반
TradingSymbol 구조와 공개 거래 종목 조회 API를 제공한다. 루트 `readme.md`,
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

Trading 전용 DB(권장 이름 `yogimangchi_trading`)와 `trading` 스키마를 사용한다.
Content의 DB/스키마/계정 권한과 분리한다. `trading`은 Flyway/Hibernate의 공통 기본 스키마다.

- V1: 테이블과 PK, Unique/Check/Not-null 제약 생성
- V2: 공식 Binance 메타데이터로 확인한 초기 12개 종목 등록
- Flyway가 순서와 체크섬을 관리하며 정상 적용된 Seed는 재시작 시 다시 실행하지 않는다.
- 운영 중 변경한 상태/Provider Mapping을 Seed가 덮어쓰지 않는다.
- 적용한 마이그레이션은 수정하지 않고 새 버전 파일을 추가한다.
- Hibernate `ddl-auto=validate`는 Entity/테이블 매핑만 검사하며 스키마를 생성·수정하지 않는다.
- `open-in-view=false`, `spring.sql.init.mode=never`, `spring.flyway.clean-disabled=true`를 사용한다.
- DB 연결·마이그레이션·매핑 검증에 실패하면 기동을 실패시킨다.

Flyway는 현재 PostgreSQL SQL 두 파일만으로 변경 이력과 재현성을 확보할 수 있어 선택했다.
별도의 XML/YAML 변경 모델은 필요하지 않다. SQL 버전 관리가 추가되고 이미 적용한 파일의
수정/임의 롤백을 피해야 한다는 운영 부담이 있다.
[Spring DB 초기화 지침](https://docs.spring.io/spring-boot/3.5/how-to/data-initialization.html)을 따른다.

## 환경변수

| 변수 | 의미 |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `local` 또는 `prod`; 동시에 지정하지 않는다 |
| `TRADING_SERVER_PORT` | HTTP 포트, 기본 8081 |
| `TRADING_DB_URL` | 필수 PostgreSQL JDBC URL |
| `TRADING_DB_USERNAME` | 필수 애플리케이션 계정 |
| `TRADING_DB_PASSWORD` | 필수 애플리케이션 비밀번호 |
| `TRADING_MIGRATION_USERNAME` | prod의 필수 Flyway 전용 계정 |
| `TRADING_MIGRATION_PASSWORD` | prod의 필수 Flyway 비밀번호 |
| `TRADING_DB_PORT` | 로컬 Compose의 DB 포트, 기본 5433; JDBC URL과 맞춘다 |

local은 하나의 로컬 계정으로 초기화와 실행한다. prod는 같은 DB URL에 Flyway 계정을 별도로 사용한다.
실제 비밀번호/운영 주소를 저장소에 넣지 않는다. `.env.example`은 예시이며
**Spring Boot는 `.env`를 자동으로 읽지 않는다.** 셸/IDE/배포 환경에서 변수를 전달한다.
Docker Compose는 자체 `.env` 처리 규칙을 따른다.

## 로컬 실행

JDK 17과 Docker Desktop Linux 엔진을 준비하고 `trading-server`에서 실행한다.
아래 비밀번호 입력은 PowerShell 7 기준이다.

```powershell
$env:SPRING_PROFILES_ACTIVE = 'local'
$env:TRADING_SERVER_PORT = '8081'
$env:TRADING_DB_URL = 'jdbc:postgresql://localhost:5433/yogimangchi_trading'
$env:TRADING_DB_USERNAME = 'trading_local'
$env:TRADING_DB_PASSWORD = Read-Host 'Local PostgreSQL password' -MaskInput
docker compose -f compose.local.yml up -d --wait
.\gradlew.bat bootRun
```

Compose는 DB만 시작하며 localhost에만 포트를 공개하고 이름 있는 Volume에 데이터를 보존한다.
초기 계정은 **로컬 개발 전용**으로 운영에 사용하지 않는다. 기존 Volume의 계정/비밀번호는
환경변수 변경만으로 바뀌지 않는다. 중지는 `docker compose -f compose.local.yml down`이다.
`-v`는 데이터를 삭제하므로 데이터 폐기가 필요한 경우에만 사용한다.
Docker CLI가 PATH에 없다면 설치된 CLI의 절대 경로를 사용하거나 PATH를 구성한다.

- 공개 API: `http://localhost:8081/api/v1/symbols`
- local Swagger: `http://localhost:8081/swagger-ui/index.html`
- local OpenAPI: `http://localhost:8081/v3/api-docs`, `/v3/api-docs.yaml`

## 운영 계정 경계

DBA가 DB/계정을 먼저 준비한다. 다음은 신규 DB 초기 구성용 `psql` 예시이며,
기존 DB에 그대로 반복 실행하지 않는다. 비밀번호는 `\password` 프롬프트로 지정한다.

```sql
CREATE ROLE trading_migrator LOGIN;
CREATE ROLE trading_app LOGIN;
\password trading_migrator
\password trading_app
CREATE DATABASE yogimangchi_trading OWNER trading_migrator;
\connect yogimangchi_trading
REVOKE ALL ON DATABASE yogimangchi_trading FROM PUBLIC;
GRANT CONNECT ON DATABASE yogimangchi_trading TO trading_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA trading AUTHORIZATION trading_migrator;
GRANT USAGE ON SCHEMA trading TO trading_app;
ALTER DEFAULT PRIVILEGES FOR ROLE trading_migrator IN SCHEMA trading
    GRANT SELECT ON TABLES TO trading_app;
```

현재 애플리케이션 계정은 SELECT만 필요하다. DDL/Seed는 마이그레이션 계정이 수행한다.
이미 생성된 테이블에는 별도로 SELECT 권한을 부여한다. 쓰기 기능 도입 시 필요한 테이블과
Sequence 권한만 추가한다. Content 계정에 Trading DB/스키마 접근 권한을 부여하지 않는다.
현재 기동 시 Flyway를 실행하므로 두 계정이 프로세스에 전달된다. 향후 배포 파이프라인에서
마이그레이션을 별도 실행하면 장기 실행 프로세스에서 DDL 자격증명을 제거할 수 있다.

필수 환경변수를 배포 환경에 등록한 뒤 실행한다.

```powershell
$env:SPRING_PROFILES_ACTIVE = 'prod'
java -jar build/libs/trading-server-0.0.1-SNAPSHOT.jar
```

prod/프로필 미지정 시 문서는 비활성화되고 Security도 접근을 차단한다.
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
local 문서 접근과 기본 계정 미생성, 폼 로그인/Basic/로그아웃/요청 캐시 비활성화,
CSRF 기본 보호를 유지했다. JWT/세션/토큰 저장 정책은 아직 구현·결정하지 않았다.
CORS는 실제 Frontend Origin이 정해질 때 명시적으로 허용 목록을 정한다.

현재 업무 예외가 없어 BusinessException/ErrorCode를 미리 만들지 않았다.
전역 `ApiExceptionHandler`는 MVC 오류 처리를 유지하고 예상하지 못한 오류를
`application/problem+json`의 500 응답으로 반환한다. 내부 예외/SQL/Stack Trace는 응답에 넣지 않고
원인은 서버 로그에 남긴다. Service에서 예외를 삼키지 않는다.

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

루트 `docs/trading-openapi.yaml`은 실제 local endpoint에서 생성한다.
API 변경 후 local 서버를 실행하고 `trading-server`에서 아래 명령으로 갱신해 코드와 함께 리뷰한다.
별도 생성 플러그인이나 수작업으로 중복 관리하는 DTO 스키마는 사용하지 않는다.

```powershell
Invoke-WebRequest 'http://localhost:8081/v3/api-docs.yaml' -OutFile '../docs/trading-openapi.yaml'
```

OpenAPI 서버 URL은 `/`로 지정해 임시 포트/호스트가 명세에 들어가지 않게 했다.
자동 테스트가 실제 생성된 명세와 저장된 YAML을 비교하므로 API 변경 후 갱신을 빠뜨리면 실패한다.
설계/Provider Mapping은 `../docs/trading-symbols.md`를 참고한다.
Order/Fill/Position/Wallet, Binance 연결, Redis, JWT, Admin, Trading Engine은 이번 구현에 없다.
