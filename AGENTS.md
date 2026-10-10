# Yogimangchi V2 Agent Instructions

프로젝트의 전체 목적, 기능 범위 및 아키텍처는 루트의 `README.md`를 먼저 참고한다.

이 문서는 개발 시 지켜야 할 불변조건, 기본 선호와 작업 원칙을 정의한다. README는 프로젝트 목적·현재 구현·실행 방법을 설명하며, 구체적인 구현 방법은 불변조건 안에서 Agent가 선택한다.

특정 애플리케이션 또는 디렉터리에 별도의 `AGENTS.md`가 존재하는 경우 루트 규칙과 함께 해당 하위 규칙을 반드시 따른다.

- `trading-server`를 수정할 경우 `trading-server/AGENTS.md`의 추가 규칙을 반드시 따른다.
- 향후 다른 디렉터리에 별도의 `AGENTS.md`가 추가될 경우 해당 디렉터리 작업에는 그 규칙을 함께 적용한다.

---

## 1. Core Principles

- Yogimangchi V2는 새로운 설계로 처음부터 구축하는 Greenfield 프로젝트다.
- 현재 V2 Repository에 존재하는 코드와 문서를 기준으로 개발한다.
- 개발 기간은 약 2주를 목표로 하지만 일정 때문에 설계 또는 구현 품질을 낮추지 않는다.
- 개발 속도보다 **실무 및 운영 환경에서 사용할 수 있는 수준의 코드 품질, 안정성, 데이터 정합성, 보안 및 유지보수성**을 우선한다.
- 구현이 복잡해지더라도 현재 기능에 실질적으로 필요한 구조라면 단순화를 이유로 배제하지 않는다.
- 반대로 실제 필요성이 없는 과도한 추상화, 미래 기능을 위한 선행 구현, 기술 과시는 피한다.
- 현재 방식보다 실무 및 운영 환경에 적합한 방식이 있다면 단순히 현재 지시를 따르지 말고 **반드시** 문제점과 권장 방식을 설명한다.
- 요구사항을 만족하는 가장 단순하고 안정적인 구현을 우선한다. 기존 구조를 존중하되 명확히 더 나은 방식은 개선할 수 있다.
- 현재 요구사항에 필요한 의존성은 Agent가 추가할 수 있다. 이미 제공되는 기능으로 충분하면 추가하지 않는다.
- 의존성을 추가한 경우 도입 이유, 기존 기능으로 해결하지 않은 이유, 보안·호환성·운영 영향을 완료 보고에서 설명한다.
- Java/Spring Boot/PostgreSQL 등 프로젝트 기반 기술 자체를 변경할 때는 사전 승인을 받는다. 일반적인 구현·의존성 선택 때문에 작업을 중단하지 않는다.
- 비밀번호, API Key, JWT 서명키 등 실제 비밀값을 Repository에 저장하지 않는다. 환경변수 또는 적절한 Secret 관리 수단을 사용한다.
- 현재 V2 Repository에 이미 구현된 코드가 있다면 새로운 코드를 작성하기 전에 기존 구현의 재사용 가능성을 확인한다.

---

## 2. Technology Baseline

Backend의 기본 기술 기준은 다음과 같다.

- Java 17
- Spring Boot 3.5.x
- Gradle
- PostgreSQL
- Redis

Spring Boot의 Major 또는 Minor Version을 임의로 변경하지 않는다.

기반 기술 변경은 변경 이유와 호환성 영향을 설명하고 사전 승인을 받는다. 현재 Java 17 / Spring Boot 3.5.x 기준을 유지한다.

---

## 3. Repository Structure

Yogimangchi V2는 하나의 Git Repository에서 관리하는 Monorepo를 기본으로 한다.

개념적인 구조:

```text
Yogimangchi-V2/
├── README.md
├── AGENTS.md
├── docker-compose.yml
├── .env.example
├── docs/
├── frontend/
├── content-server/
└── trading-server/
```

Rules:

- `frontend`, `content-server`, `trading-server` 내부에 별도의 Git Repository를 생성하지 않는다.
- 하나의 Repository를 사용하더라도 각 애플리케이션의 실행, 배포 및 데이터 소유권 경계는 독립적으로 유지한다.
- Git Repository 경계와 애플리케이션 경계를 동일한 개념으로 취급하지 않는다.
- 공용 Docker Compose는 Repository 루트의 `docker-compose.yml`에서 관리한다.
- 애플리케이션 디렉터리별 Compose 파일을 기본 구조로 만들지 않는다.
- 공용 로컬 인프라 환경변수 예시는 루트 `.env.example`에서 관리한다.

---

## 4. Application Boundaries

Yogimangchi V2 Backend는 두 개의 독립된 Spring Boot 애플리케이션으로 구성한다.

### `content-server`

주요 책임:

- 회원
- 인증/인가
- 뉴스
- 커뮤니티
- 댓글
- 검색
- Content 영역에서 발생하는 알림

### `trading-server`

주요 책임:

- Binance WebSocket 실시간 시세 수신
- 서버 기준 가격 관리
- 모의투자 주문 및 체결
- 자산
- 포지션
- 모의투자 대회
- 랭킹
- Trading 영역에서 발생하는 알림

### Boundary Rules

- `content-server`와 `trading-server`의 책임을 임의로 합치거나 이동하지 않는다.
- 두 애플리케이션은 향후 독립적으로 배포, 분리 및 확장할 수 있는 경계를 유지한다.
- 공용 PostgreSQL Database 이름은 `yogimangchi`이며 애플리케이션의 데이터 소유권은 Schema 기준으로 분리한다.
- Trading Schema는 `trading`, 향후 Content Schema는 `content`이며 현재 `content` Schema는 미리 생성하지 않는다.
- 다른 애플리케이션이 소유한 Entity를 현재 애플리케이션의 JPA Entity에서 연관관계로 참조하지 않는다.
- 다른 애플리케이션이 소유한 테이블을 직접 조회, JOIN, INSERT, UPDATE 또는 DELETE하지 않는다.
- 다른 애플리케이션의 데이터를 참조해야 하는 경우 필요한 식별자(ID)만 저장한다.
- 다른 애플리케이션의 기능 실행이 필요한 경우 상대 애플리케이션의 DB를 직접 조작하지 않고 명시적인 애플리케이션 간 통신 방식을 사용한다.
- 예: `trading-server`의 `Order`는 `content-server`의 `Member`를 `@ManyToOne`으로 참조하지 않고 `memberId`만 저장한다.
- 예: `trading-server`가 `content-server` 소유의 알림 테이블에 직접 알림을 INSERT하지 않는다.

---

## 5. Data Responsibilities

### PostgreSQL

영구적으로 보존되어야 하며 데이터 정합성이 필요한 데이터의 원본 저장소로 사용한다.

예:

- 회원
- 게시글 및 댓글
- 뉴스
- 주문 및 체결
- 자산 및 포지션
- 대회 데이터
- 영구 보존이 필요한 알림

### Redis

Redis를 영구 데이터의 유일한 원본 저장소로 사용하지 않는다.

주요 용도:

- 실시간 가격
- 캐시
- 랭킹
- TTL이 필요한 데이터
- 필요한 경우 Pub/Sub

Redis 데이터가 유실되더라도 영구적으로 보존되어야 하는 핵심 데이터의 정합성이 깨지는 구조를 만들지 않는다.

### Trading Price Rule

- 주문 요청에 포함된 Frontend 가격을 실제 체결 가격으로 신뢰하지 않는다.
- 주문 및 체결은 `trading-server`가 관리하는 서버 기준 가격을 사용한다.
- 서버 기준 가격은 Binance WebSocket으로 수신한 데이터를 기반으로 관리한다.
- 클라이언트가 임의로 전달한 가격으로 주문 결과나 자산 상태를 결정하지 않는다.

---

## 6. Work Rules

- 작업을 시작하기 전에 `README.md`, 이 문서, 현재 V2 Repository의 관련 구현을 확인한다.
- 요청된 기능과 관련된 기존 V2 코드가 있다면 먼저 구조와 재사용 가능성을 확인한다.
- 아직 존재하지 않는 기능이나 패키지를 단순히 미래에 사용할 가능성이 있다는 이유로 미리 구현하지 않는다.
- 요청된 작업 범위를 불필요하게 확장하지 않는다.
- 요청 범위 안의 구조·데이터 모델·구현 선택은 Agent가 판단하고 중요한 선택과 근거를 완료 보고에서 설명한다. 불변조건을 위반하거나 요구 범위를 바꾸는 변경은 임의로 진행하지 않는다.
- 현재 지시가 데이터 정합성, 보안, 장애 대응 또는 운영 안정성 측면에서 문제가 있다면 그대로 구현하지 말고 문제를 알린다.
- 중요한 동작은 의미 있는 자동 테스트로 검증하고 관련 테스트와 빌드를 실행한다. 실패를 숨기기 위해 테스트를 삭제하거나 비활성화하지 않는다.
- 작업 완료 시 테스트/빌드 결과와 중요한 설계 결정을 설명한다.

---

## 7. Package Structure

최상위 패키지는 Layer 기준이 아닌 Domain/Feature 기준으로 구성한다.

예:

```text
order/
asset/
tradingsymbol/
competition/
ranking/
```

각 Domain 내부에서 실제 필요한 Layer를 구성한다.

예:

```text
order/
├── controller/
├── service/
├── repository/
├── entity/
└── dto/
```

Rules:

- 사용하지 않는 Domain 또는 하위 패키지를 미리 생성하지 않는다.
- 모든 Controller, Service, Repository 등을 각각 하나의 최상위 Layer 패키지에 모으는 구조를 사용하지 않는다.
- Domain 간 책임을 불필요하게 섞지 않는다.
- 공통 코드라는 이유만으로 성급하게 `common` 또는 `util` 영역으로 이동하지 않는다.

---

## 8. JPA Rules

### Entity Relationships

- Entity 관계는 같은 애플리케이션 소유 데이터 사이에서 실제 필요한 경우에만 사용한다. 다른 애플리케이션의 Entity 참조 금지는 유지한다.
- 기본적으로 단방향 LAZY 관계와 명시적인 업무 처리를 선호한다.
- 불필요한 collection·양방향 관계를 피한다. 관계 종류 자체를 일괄 금지하지 않으며 생명주기와 조회 비용을 근거로 선택한다.

### Query Rules

- 필요한 데이터만 조회하는 명시적 Query와 DTO Projection을 선호한다.
- Fetch Join / EntityGraph는 N+1 등 실제 조회 문제를 더 단순하고 명확하게 해결할 때 사용할 수 있다.
- 페이징, 카디널리티, 불필요한 로딩 및 쿼리 수에 미치는 영향을 확인한다. 예외적인 선택의 이유를 코드 또는 완료 보고에서 설명한다.

### Lifecycle Rules

- 연관 데이터 변경은 업무 Transaction 경계 안에서 명확하게 드러나야 한다.
- Cascade / orphanRemoval은 기본적으로 피하되, 동일한 생명주기를 실제로 소유하고 영향 범위를 검증할 수 있을 때 사용한다.
- 어떤 매핑 방식도 Data Retention 규칙을 우회하여 업무 이력을 삭제해서는 안 된다.

---
## 9. Entity Rules

- Entity에 Setter를 만들지 않는다.
- Lombok `@Setter`를 Entity에 사용하지 않는다.
- Entity에 Lombok `@Builder`를 사용하지 않는다.
- Getter는 사용할 수 있다.
- JPA 기본 생성자는 `protected` 접근 수준으로 제한한다.
- Entity 생성은 생성 의도가 드러나는 생성자 또는 정적 팩토리 메서드를 사용한다.
- Entity 상태 변경은 Setter 대신 의미 있는 Domain Method를 사용한다.

예:

```java
order.cancel();
order.fill(price);
```

다음과 같이 외부에서 Entity 상태를 직접 변경하지 않는다.

```java
order.setStatus(...);
order.setPrice(...);
```

- Entity를 Controller의 API Response로 직접 반환하지 않는다.
- API Request/Response에는 DTO를 사용한다.

---

## 10. Authentication Rules

지원하는 로그인 방식은 다음 세 가지로 제한한다.

- Google OAuth2
- Kakao OAuth2
- One-click Guest Login

Rules:

- 일반 ID/Password 회원가입 및 로그인을 구현하지 않는다.
- 인증 및 인가에는 Spring Security를 사용한다.
- Google/Kakao OAuth2 인증 성공 후 Yogimangchi 자체 JWT를 발급한다.
- Google 또는 Kakao에서 발급한 OAuth Access Token을 Yogimangchi API 인증 토큰으로 직접 사용하지 않는다.
- Guest 로그인 역시 Yogimangchi 자체 JWT를 발급한다.
- 로그인 방식과 관계없이 로그인 완료 이후에는 동일한 JWT 기반 인증 흐름을 사용한다.
- `content-server`와 `trading-server`는 각각 요청에 포함된 Yogimangchi JWT를 검증하고 인증 정보를 구성한다.
- `trading-server`는 JWT 인증을 위해 매 요청마다 `content-server`에 사용자 인증 여부를 조회하지 않는다.
- 인증된 사용자는 애플리케이션 간에 `Member` Entity를 공유하지 않고 `memberId`를 기준으로 식별한다.
- JWT Access/Refresh Token 구성과 클라이언트 저장 방식은 별도 결정 전까지 임의로 확정하지 않는다.

---

## 11. Notification Boundary

- Content 영역에서 발생한 알림과 Trading 영역에서 발생한 알림은 각각 해당 애플리케이션이 소유할 수 있다.
- `content-server`는 댓글, 답글, 커뮤니티 등 Content 영역에서 발생하는 알림을 담당할 수 있다.
- `trading-server`는 주문 체결, 주문 상태 변경, 대회 등 Trading 영역에서 발생하는 알림을 담당할 수 있다.
- 한 애플리케이션이 다른 애플리케이션 소유의 알림 테이블을 직접 수정하지 않는다.
- Content 알림과 Trading 알림을 하나의 사용자 화면으로 제공해야 하는 경우 각 애플리케이션의 API 결과를 Frontend에서 통합하여 시간순으로 표현하는 방식을 사용할 수 있다.
- 알림 통합 방식이 페이징, 읽음 상태, 실시간 전달 등의 요구사항으로 인해 복잡해질 경우 현재 구조를 억지로 유지하지 말고 Backend 통합 API 또는 별도 알림 구조를 검토한다.
- 현재 단계에서 알림만을 위한 별도의 Notification Server를 미리 만들지 않는다.

---

## 12. Infrastructure Constraints

배포 시 기본 인프라는 다음을 기준으로 한다.

- Next.js → Vercel
- Spring Boot → Docker
- PostgreSQL → Docker
- Redis → Docker
- Nginx
- Docker Compose
- GitHub Actions

현재 실행 구조와 환경변수는 루트 및 애플리케이션 README를 따른다. 실행 절차를 AGENTS에 중복 관리하지 않는다.

현재 V2에서는 기본적으로 다음 기술을 사용하지 않는다.

- Kubernetes
- Kafka

단, 향후 실제 요구사항 또는 운영상의 문제가 발생하여 새로운 인프라 기술이 필요해지는 경우 무조건 배제하지 않는다.

현재 요구사항에 실질적으로 필요한지 평가하며, 범위를 벗어난 인프라를 선행 도입하지 않는다. 기반 기술 변경의 승인 규칙은 Core Principles를 따른다.

현재 하나의 서버 또는 PostgreSQL 인스턴스에서 운영하더라도 애플리케이션 경계와 데이터 소유권은 유지하여 향후 물리적으로 분리할 수 있는 구조를 지향한다.

---

## 13. API Documentation Rules

- REST API는 OpenAPI 3 / Swagger 기반으로 문서화한다.
- Spring에서는 `springdoc-openapi`를 사용한다.
- `content-server`와 `trading-server`의 OpenAPI 문서는 각각 독립적으로 관리한다.
- API를 추가하거나 Request/Response 구조를 변경할 경우 관련 OpenAPI 문서도 함께 최신 상태로 유지한다.
- Request/Response DTO의 주요 필드, API의 목적, 주요 응답 상태를 문서에서 이해할 수 있어야 한다.
- Swagger 문서화를 위해 Controller에 불필요하게 많은 Annotation을 추가하지 않는다.
- `@Operation`, `@Schema`, 응답 관련 Annotation 등은 자동 생성되는 정보만으로 API의 의미를 충분히 전달할 수 없는 경우에 사용한다.
- 문서화를 위해 Controller의 가독성이나 비즈니스 코드 구조를 훼손하지 않는다.
- 개발 환경에서는 Swagger UI와 OpenAPI Docs endpoint를 사용할 수 있다.
- 운영 환경에서는 Swagger UI와 OpenAPI Docs endpoint를 외부에 노출하지 않는다.
- 포트폴리오 및 API 계약 확인을 위해 Content/Trading의 OpenAPI 명세를 별도의 YAML 또는 JSON 문서로 남길 수 있다.

---

## 14. Exception & Failure Handling Rules

### API Exception Handling

- API 예외 응답은 `@RestControllerAdvice` 기반의 전역 예외 처리 방식을 사용한다.
- API마다 개별적으로 예외 응답 형식을 구현하지 않는다.
- API 오류 응답은 일관된 구조를 사용한다.
- 비즈니스 규칙 위반은 의미 있는 ErrorCode와 공통 BusinessException 계열로 표현한다.
- 예외 종류마다 불필요하게 Handler 메서드와 Exception 클래스를 증가시키지 않는다.
- 예상하지 못한 서버 오류의 내부 구현 정보나 Stack Trace를 API Response에 노출하지 않는다.
- Validation, 인증/인가, 비즈니스 예외, 예상하지 못한 서버 오류를 구분하여 처리한다.

### Transaction & Rollback

- 데이터 정합성이 필요한 여러 DB 변경은 적절한 Transaction 경계 안에서 처리한다.
- Transaction 범위는 Controller가 아닌 Service Layer의 업무 단위를 기준으로 설정한다.
- 예외 처리 과정에서 정상적인 Transaction Rollback을 방해하도록 예외를 무분별하게 catch하여 삼키지 않는다.
- 주문, 체결, 자산 변경처럼 함께 성공하거나 실패해야 하는 작업은 원자성을 보장한다.

### External System Failure

- S3, 외부 API, WebSocket, 다른 애플리케이션 등 외부 시스템 작업은 DB Transaction만으로 Rollback할 수 있다고 가정하지 않는다.
- 외부 시스템과 DB 변경이 함께 발생하는 작업은 실패 시 데이터 정합성에 미치는 영향을 먼저 검토한다.
- 필요한 경우 보상 작업, 재시도, 실패 상태 저장, Outbox 등의 방식을 검토한다.
- 이러한 패턴을 모든 기능에 미리 적용하지 않고 실제 정합성 및 복구 요구사항이 있는 기능에 적용한다.
- 외부 시스템 장애를 이유로 무한 재시도하거나 요청 Thread를 장시간 점유하지 않는다.

### Logging

- 일반적인 애플리케이션 오류를 별도의 Error Log 테이블에 무조건 저장하지 않는다.
- 예상하지 못한 서버 오류는 원인 분석이 가능하도록 적절한 수준의 로그를 남긴다.
- 비밀번호, JWT, OAuth Token, 개인정보 등 민감한 정보를 로그에 기록하지 않는다.
- 업무적으로 추적, 복구 또는 재시도가 필요한 실패는 단순 로그와 구분하여 상태 데이터로 관리할 수 있다.
- 로그 저장 및 모니터링 기술은 실제 운영 요구사항이 정해지기 전까지 특정 제품에 종속시키지 않는다.

---

## 15. Data Retention & Deletion Rules

- 회원, 게시글, 댓글, 주문, 체결, 포지션, 대회 등 업무 및 이력 데이터는 기본적으로 물리 삭제하지 않는다.
- 업무 데이터의 삭제가 필요한 경우 Soft Delete 또는 상태 변경 방식으로 처리한다.
- Trading의 주문, 체결 등 이력 데이터는 삭제 개념보다 상태 전이를 우선한다.
  - 예: `PENDING`, `FILLED`, `CANCELED`, `LIQUIDATED`
- Soft Delete 대상 Entity에는 프로젝트에서 정한 일관된 삭제 상태 또는 `deletedAt` 정책을 사용한다.
- Soft Delete된 데이터가 일반 조회 결과에 포함되지 않도록 조회 정책을 명확하게 관리한다.
- Hard Delete는 임시 데이터, 만료 데이터, 보안/개인정보 파기, 운영상 데이터 보존 정책 등 명확한 이유가 있는 경우에만 허용한다.
- Hard Delete가 필요할 경우 임의로 적용하지 말고 이유와 영향 범위를 먼저 설명한다.
- 단순히 데이터가 필요 없어졌다는 이유만으로 업무 이력을 삭제하지 않는다.
