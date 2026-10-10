# Yogimangchi V2

코인 실시간 시세, 뉴스, 커뮤니티와 모의투자 대회를 제공하는 **코인 정보 + 커뮤니티 서비스**다.

기존 Yogimangchi V1의 코드를 리팩터링하는 프로젝트가 아니라, V2의 목적과 구조에 맞게 **새로운 설계로 처음부터 구축한다.**

기존 V1 코드는 참고하지 않는다.

---

# 1. 프로젝트 목표

기존 **모의투자 중심 서비스**를 실제 사용자가 지속적으로 이용할 수 있는 **코인 정보 + 뉴스 + 커뮤니티 서비스**로 리메이크한다.

기존에 여러 종류로 나뉘어 있던 모의투자는 하나의 **대회형 콘텐츠**로 단순화한다.

서비스의 중심은 다음과 같다.

```text id="jzx9jk"
실시간 코인 정보
       +
최신 코인 뉴스
       +
커뮤니티
       +
모의투자 대회
```

로그인하지 않은 사용자도 대부분의 콘텐츠를 바로 확인할 수 있도록 하고, 로그인하면 커뮤니티 참여와 모의투자를 사용할 수 있도록 한다.

### 개발 기간

목표 개발 기간은 **약 2주**다.

다만 2주는 목표 기간일 뿐 절대적인 마감 기한이 아니다.

일정을 맞추기 위해 설계, 안정성, 데이터 정합성, 보안 또는 유지보수성을 희생하지 않는다.

**개발 속도보다 실제 실무 및 운영 환경에 가까운 품질을 우선한다.**

불필요하게 복잡한 구조는 만들지 않지만, 현재 기능에 실질적으로 필요한 구조라면 구현 복잡도를 이유로 배제하지 않는다.

---

# 2. 주요 기능

## 로그인 없이 사용

- 실시간 코인 시세
- 코인 차트
- 최신 뉴스
- 커뮤니티 글 조회
- 인기글
- 모의투자 대회 현황
- 모의투자 랭킹

## 로그인 필요

- 게시글 작성
- 댓글 작성
- 모의투자 주문
- 대회 참가
- 개인 자산 조회
- 포지션 조회
- 개인 알림

---

# 3. 인증 방식

일반적인 ID/Password 회원가입 및 로그인은 구현하지 않는다.

다음 세 가지 로그인 방식만 지원한다.

```text id="c8gf8z"
Google OAuth2
Kakao OAuth2
Guest One-click Login
        │
        ↓
Yogimangchi JWT
        │
        ├─ Content Server
        └─ Trading Server
```

사용 기술:

- Spring Security
- OAuth2
- JWT

Google/Kakao OAuth2는 사용자의 신원을 확인하기 위한 로그인 수단으로 사용한다.

OAuth2 로그인 성공 후 Yogimangchi 자체 JWT를 발급하고 이후 API 인증에는 해당 JWT를 사용한다.

Guest 로그인 역시 자체 JWT를 발급하여 OAuth2 사용자와 동일한 인증 흐름을 사용한다.

이를 통해 로그인 방식과 관계없이 Backend에서는 사용자를 동일한 방식으로 처리한다.

---

# 4. 기술 스택

## Frontend

- Next.js
- TypeScript
- Vercel Free

## Backend

### Content Spring

- 회원
- 인증/인가
- 뉴스
- 커뮤니티
- 댓글
- 검색
- Content 영역 알림

### Trading Spring

- Binance WebSocket
- 실시간 시세
- 주문
- 체결
- 자산
- 포지션
- 모의투자 대회
- 랭킹
- Trading 영역 알림

## Data

- PostgreSQL
- Redis

## Infra

- EC2 또는 VPS
- Docker
- Docker Compose
- Nginx
- GitHub Actions CI/CD

현재 Kubernetes와 Kafka는 사용하지 않는다.

---

# 5. 전체 배포 구조

Frontend는 Vercel에 배포하고 Backend 및 데이터 인프라는 하나의 EC2/VPS에서 시작한다.

```text id="0vxqzp"
[Vercel]

Next.js
   │
   │ HTTPS
   ↓
[EC2 / VPS]

Nginx
   │
   ├─ Content Spring Container
   │
   └─ Trading Spring Container
   │
   ├─ PostgreSQL Container
   └─ Redis Container
```

초기에는 비용과 운영 복잡도를 고려하여 **하나의 EC2/VPS에서 모든 Backend Container를 실행한다.**

하지만 각 프로그램은 독립된 Docker Container로 분리한다.

이를 통해 하나의 서버를 사용하면서도 애플리케이션과 인프라의 역할을 논리적으로 분리한다.

---

# 6. Docker 구성

Docker에서는 Image와 Container를 구분한다.

**Image = 프로그램을 실행하기 위한 설계도**

**Container = Image를 실제 실행한 인스턴스**

```text id="s9sf9y"
Content Image
    ↓
Content Container

Trading Image
    ↓
Trading Container

PostgreSQL Image
    ↓
PostgreSQL Container

Redis Image
    ↓
Redis Container

Nginx Image
    ↓
Nginx Container
```

하나의 Container에 여러 프로그램을 넣지 않고 역할별로 Container를 분리한다.

전체 Container는 Docker Compose로 관리한다.

공용 Docker Compose는 Repository 루트의 `docker-compose.yml`에서 관리하며,
로컬 인프라는 Repository 루트에서 `docker compose up -d`로 실행한다.
현재 로컬 Compose에는 PostgreSQL과 Redis만 포함하며, Spring Boot는 IDE에서 직접 실행한다.
아래는 향후 운영/배포 단계의 구성이다.

```text id="18p1wh"
docker-compose.yml

├─ Content
├─ Trading
├─ PostgreSQL
├─ Redis
└─ Nginx
```

애플리케이션을 Container 단위로 분리함으로써 독립적인 실행, 재시작, 배포가 가능하도록 한다.

---

# 7. Backend 애플리케이션 분리

Backend는 하나의 거대한 Spring Boot 애플리케이션으로 만들지 않고 두 개의 독립적인 애플리케이션으로 구성한다.

## Content Spring

일반적인 콘텐츠 및 사용자 기능을 담당한다.

```text id="8qvzjn"
회원
인증
뉴스
커뮤니티
댓글
검색
Content 알림
```

## Trading Spring

실시간 시세 및 모의투자 기능을 담당한다.

```text id="8kyngk"
Binance WebSocket
실시간 시세
주문
체결
자산
포지션
대회
랭킹
Trading 알림
```

현재 같은 EC2에서 실행하더라도 서로 다른 **Spring Boot Application + Docker Container**로 구성한다.

이를 통해 코드와 책임을 분리하고 향후 필요할 경우 각각 독립적으로 배포하거나 물리 서버를 분리할 수 있도록 한다.

---

# 8. 애플리케이션 데이터 소유권

현재는 공용 PostgreSQL Database `yogimangchi`를 사용하며, Trading은 `trading`, 향후 Content는 `content` Schema로 **데이터 소유권을 논리적으로 분리한다.** 현재 `content` Schema는 미리 생성하지 않는다.

```text id="z9tqmv"
                PostgreSQL
                    │
          ┌─────────┴─────────┐
          │                   │
   Content 소유 데이터    Trading 소유 데이터
          │                   │
       Member               Order
       Post                 Fill
       Comment              Asset
       News                 Position
       ...                  Competition
```

각 애플리케이션은 다른 애플리케이션이 소유한 테이블을 직접 조회하거나 변경하지 않는다.

즉 다른 애플리케이션의 테이블에 대해 직접:

- SELECT
- JOIN
- INSERT
- UPDATE
- DELETE

하지 않는다.

예를 들어 `Member`는 Content가 소유한다.

Trading의 `Order`에서 Content의 `Member` Entity를 JPA 관계로 연결하지 않는다.

```text id="z4b9mo"
Content

Member
id = 10


Trading

Order
memberId = 10
```

Trading은 필요한 사용자의 `memberId`만 저장한다.

이를 통해 현재 하나의 PostgreSQL Database를 사용하더라도 향후 필요하면 애플리케이션별 데이터를 물리적으로 분리할 수 있는 구조를 유지한다.

---

# 9. PostgreSQL / Redis 역할

PostgreSQL과 Redis는 같은 EC2에서 시작하지만 **서로 다른 Docker Container로 실행한다.**

두 저장소의 역할도 명확하게 구분한다.

## PostgreSQL

영구적으로 보존되어야 하고 데이터 정합성이 중요한 데이터의 원본 저장소로 사용한다.

예:

```text id="ojccae"
회원
게시글
댓글
뉴스
주문
체결
자산
포지션
대회
영구 알림
```

## Redis

빠르게 접근하거나 일시적으로 관리할 데이터에 사용한다.

예:

```text id="4qvlyp"
실시간 가격
캐시
실시간 랭킹
TTL 데이터
Pub/Sub
```

Redis를 영구 데이터의 유일한 원본 저장소로 사용하지 않는다.

Redis 데이터가 유실되더라도 영구적으로 보존해야 하는 핵심 데이터의 정합성이 깨지지 않는 구조를 지향한다.

---

# 10. 실시간 시세 및 주문 가격 원칙

클라이언트에 표시되는 가격과 실제 모의투자 체결에 사용하는 가격의 신뢰 주체를 구분한다.

```text id="8mtfdi"
Binance WebSocket
        ↓
Trading Spring
        ↓
Redis / Memory
        ↓
Frontend
```

Frontend는 서버가 전달한 가격을 사용자에게 표시한다.

하지만 주문 요청 시 Frontend가 전달하는 가격을 실제 체결 가격으로 신뢰하지 않는다.

```text id="tzosmw"
Frontend

"BTC를 현재 가격에 매수"
        │
        │ 주문 요청
        ↓
Trading Spring
        │
        ├─ 서버가 관리하는 BTC 가격 확인
        ├─ 주문 검증
        ├─ 체결
        └─ 자산 변경
```

실제 주문 체결과 자산 변경은 반드시 **Trading Spring이 관리하는 서버 기준 가격**을 사용한다.

따라서 사용자가 Frontend 요청의 가격을 임의로 조작하더라도 실제 주문 결과에는 영향을 줄 수 없어야 한다.

---

# 11. 알림 구조

Content와 Trading은 각자 자신의 Domain에서 발생하는 알림을 소유할 수 있다.

## Content Notification

예:

```text id="y3my2p"
댓글
답글
커뮤니티 관련 알림
```

## Trading Notification

예:

```text id="qk5pdu"
주문 체결
주문 상태 변경
대회 관련 알림
```

Trading이 Content의 알림 테이블에 직접 데이터를 저장하거나 그 반대 방향으로 접근하지 않는다.

사용자 화면에서 하나의 알림 목록으로 보여줄 경우 초기에는:

```text id="rq9r7n"
Content Notification API ──┐
                           ├─→ Frontend → 시간순 통합
Trading Notification API ─┘
```

처럼 각 Backend에서 받은 결과를 Frontend에서 통합하여 표현할 수 있다.

향후 알림의 페이징, 읽음 상태, 실시간 전달 등이 복잡해질 경우 Backend 통합 API 또는 별도 알림 구조를 검토한다.

현재 단계에서는 알림만을 위한 별도의 서버를 미리 만들지 않는다.

---

# 12. 향후 확장

초기에는 하나의 물리 서버를 사용한다.

```text id="b1zwdl"
EC2 #1

├─ Content
├─ Trading
├─ PostgreSQL
├─ Redis
└─ Nginx
```

사용량과 부하가 증가하면 각 역할을 물리적으로 분리할 수 있다.

```text id="q7mbzq"
EC2 #1
└─ Content

EC2 #2
└─ Trading

EC2 #3
└─ PostgreSQL

EC2 #4
└─ Redis
```

즉 처음부터 여러 서버를 사용하는 것이 아니라:

> **현재는 논리적으로 분리하고, 실제 필요가 생기면 물리적으로 분리한다.**

Trading의 부하가 증가하면 동일한 Trading Image를 기반으로 여러 인스턴스를 실행하는 Scale-Out도 검토할 수 있다.

```text id="x6bqxz"
                 Trading Image
                      │
           ┌──────────┼──────────┐
           ↓          ↓          ↓
      Trading #1  Trading #2  Trading #3
```

다만 Trading Server는 Binance WebSocket 연결, 주문 동시성, 공유 상태 등의 문제가 있으므로 단순히 Container 수만 증가시키는 것으로 Scale-Out이 완료되는 것은 아니다.

실제 Scale-Out 시에는 공유 상태, WebSocket 연결 구조, Redis, 주문 동시성 및 요청 분산 구조를 함께 설계한다.

---

# 13. Kubernetes / Kafka

## Kubernetes

현재는 사용하지 않는다.

하나의 서버에서 소수의 Container를 운영하는 현재 구조에서는 Docker Compose를 기본으로 사용한다.

향후 여러 물리 서버에 많은 Container를 배포하고 자동 확장, 복구, 배포 관리가 필요해질 경우 Kubernetes 도입을 검토한다.

## Kafka

현재는 사용하지 않는다.

현재 기능만을 위해 메시지 브로커를 미리 도입하지 않는다.

향후 애플리케이션 간 비동기 이벤트가 증가하거나 높은 처리량, 이벤트 전달 신뢰성, 이벤트 기반 아키텍처가 실제로 필요해질 경우 Kafka 등의 메시지 시스템 도입을 검토한다.

즉 Kubernetes와 Kafka를 영구적으로 배제하는 것이 아니라 **실제 필요성이 생기는 시점에 도입 여부를 판단한다.**

---

# 14. 포트폴리오 방향

이번 V2의 목적은 단순히 기능 개수를 많이 만드는 것이 아니다.

실제 사용자가 접속했을 때 서비스의 목적을 바로 이해하고 사용할 수 있어야 한다.

```text id="cpn2ql"
이력서
  ↓
기술적으로 궁금하게 만들기

사이트 접속
  ↓
로그인 없이 콘텐츠 확인

관심이 생김
  ↓
Guest / OAuth2 로그인

모의투자 체험
  ↓
실시간 시세 + 주문 + 자산 변화 경험

README
  ↓
설계 이유 확인

면접
  ↓
직접 설계와 구현 설명
```

첫 화면만 보고도 다음이 명확해야 한다.

> **코인 시세와 뉴스를 확인하고, 커뮤니티를 이용하며, 모의투자 대회에도 참여할 수 있는 서비스**

## 핵심 기술 포인트

- Content / Trading Spring Boot 애플리케이션 분리
- Domain/Feature 중심 구조
- Google / Kakao OAuth2
- Spring Security + JWT
- Guest One-click Login
- Binance WebSocket 실시간 데이터
- 서버 기준 주문 체결
- 주문 / 체결 / 자산 데이터 정합성
- PostgreSQL
- Redis 캐시 / 실시간 가격 / 랭킹
- 애플리케이션별 데이터 소유권 분리
- Docker Container 분리
- Docker Compose
- Nginx
- GitHub Actions CI/CD
- 향후 Scale-Out을 고려한 구조

---

# 15. 설계 원칙

> **현재 규모에 불필요한 복잡성은 만들지 않되, 실제 운영을 고려한 품질과 데이터 정합성을 지키고, 서비스가 성장했을 때 쉽게 분리하고 확장할 수 있는 구조로 만든다.**

단순히 빠르게 동작하는 코드를 만드는 것이 아니라 **왜 이렇게 설계했는지 설명할 수 있고, 실제 운영 환경에서도 발전시킬 수 있는 구조**를 목표로 한다.

---

# 16. API Documentation

API는 OpenAPI 3 기반으로 문서화한다.

- Content API: `docs/content-openapi.yaml`
- Trading API: `docs/trading-openapi.yaml`

개발 환경에서는 Swagger UI를 통해 API를 확인하고 테스트할 수 있다.
운영 환경에서는 Swagger UI와 OpenAPI Docs endpoint를 외부에 노출하지 않는다.