# Yogimangchi V2

가상 USDT를 이용한 **암호화폐 선물 모의투자**와 회원·커뮤니티·뉴스를 결합하는 서비스다. 실제 자금을 주문하거나 보관하는 거래소가 아니며, 금융 계산의 최종 책임은 Trading Server에 있다.

## 프로젝트 현황

- **Trading:** Guest·회원 모의투자, 실시간 시세, 시장가·지정가, 취소, LONG/SHORT Hedge, 격리마진, 부분/강제청산, 거래 이력, 계정 재시작·회원 회차를 구현했다.
- **Content:** Google/Kakao OAuth2, 회원가입·로그인, 프로필, 팔로우, 버전 동의, 탈퇴·재가입 및 Trading 계정 연계를 구현했다.
- **Frontend:** Next.js 거래 화면, Guest·회원 인증, 회원 정보·회차·거래 이력 연동 등 현재 구현된 화면을 제공한다.
- **후속 기능:** 커뮤니티 게시글·댓글, 뉴스·정보 피드, 서비스 공개를 위한 운영 기능. **미구현 기능을 완료로 간주하지 않는다.**
- **개발 기준:** `develop`. 미병합 PR의 기능은 현재 구현에 포함하지 않는다.

## 구성

```text
frontend/           Next.js App Router · TypeScript · React · Tailwind
content-server/     Java 17 · Spring Boot 3.5.x · PostgreSQL(content)
trading-server/     Java 17 · Spring Boot 3.5.x · PostgreSQL(trading) · Redis
docker-compose.yml  로컬 PostgreSQL 17 및 Redis 7
.env.example        공통 개발/운영 환경변수 예시
AGENTS.md           에이전트 공통 규칙
OPERATIONS_CHECKLIST.md  공개 운영 준비 항목
```

단일 Git 저장소이지만 두 백엔드는 **별개의 실행 앱과 데이터 소유권**을 유지한다. Content는 회원·콘텐츠, Trading은 시세·주문·원장을 소유한다. 두 앱은 같은 `yogimangchi` DB 인스턴스를 사용하되 스키마를 분리한다. Redis는 시세·작업 전달 및 캐시 용도이며 금융 원장의 원본이 아니다.

## 현재 인증·거래 정책

- **Guest:** Trading이 발급하는 7일 유효 opaque Bearer Token(JWT 아님). 모의투자 10,000 USDT, 동일 Guest 계정의 재도전 기능 제공.
- **회원:** Google/Kakao OAuth2 → Content 자체 RS256 Access JWT(15분, 클라이언트 메모리) 및 회전형 HttpOnly Refresh Cookie(최초 발급 기준 고정 7일). Guest 금융 기록 자동 병합 없음.
- **회원 거래:** Trading에 회원 계정을 명시적으로 생성·조회하며 첫 회차 10,000 USDT. 재시작에는 24시간 제한이 있고 과거 회차·주문·체결 원장을 보존한다.
- **선물:** 서버 기준 시세, Isolated Margin, LONG/SHORT 동시 보유, 신규 주문 레버리지 1~100배(기본 10배). **Backend 레버리지는 계정·종목·방향(LONG/SHORT)별 독립 설정**이다. GET 쿼리와 PUT 본문의 side가 필수이며 Frontend 반영 여부는 별도로 확인한다.
- **정합성:** 서버 주도 주문·청산, 계정 잠금, 트랜잭션, 멱등성 및 시세 복구 게이트를 기존 테스트로 보호한다.

## 로컬 개발 빠른 시작

1. Java 17, Node.js(지원 범위는 `frontend/package.json` 참조), Docker를 준비한다.
2. 루트 `.env.example`을 복사해 Git 추적에서 제외된 `.env`를 만들고, 필요한 환경변수를 자신의 개발 환경에 주입한다. **Spring Boot는 `.env` 파일을 자동 로드하지 않는다.**
3. 루트에서 `docker compose --env-file .env up -d`로 로컬 PostgreSQL·Redis를 실행한다. Compose는 현재 백엔드/프론트엔드/프록시까지 모두 기동하는 운영용 구성이 아니다.
4. 각 서버 디렉터리에서 환경변수와 필요한 JWT 키 등을 설정한 후 `./gradlew bootRun --args='--spring.profiles.active=local'`(Content), `./gradlew bootRun`(Trading)을 실행한다. Windows에서는 `gradlew.bat`를 사용한다.
5. `frontend/`에서 `npm ci`, `npm run dev`를 실행한다. 서버 Origin 설정 예시는 `frontend/.env.example`을 확인한다.

로컬 기본 포트는 Content `8080`, Trading `8081`, Frontend `3000`이며 DB/Redis 호스트 포트는 `.env` 설정에 따른다. OAuth와 회원 인증의 실제 테스트에는 OAuth 콘솔 설정 및 서명/검증 키가 필요하다.

## 검증 명령

```bash
# 각 백엔드 디렉터리에서
./gradlew clean build

# frontend/에서
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

일부 백엔드 통합 테스트는 Docker/Testcontainers가 필요하다. 과거 PR의 테스트 성공 기록을 **현재 환경에서 재실행한 결과로 간주하지 않는다.** 개발 환경에서 각 백엔드의 `/v3/api-docs`, `/swagger-ui/index.html`로 API 계약을 확인할 수 있으며 운영 환경에서는 비활성화된다.

## 참고 문서와 변경 정책

- [공통 에이전트 규칙](AGENTS.md)
- [Trading 안내](trading-server/README.md) · [Trading 규칙](trading-server/AGENTS.md)
- [Content 안내](content-server/README.md) · [Content 규칙](content-server/AGENTS.md)
- [Frontend 안내](frontend/README.md) · [Frontend 규칙](frontend/AGENTS.md)
- [운영 체크리스트](OPERATIONS_CHECKLIST.md)

상세 API의 최종 기준은 각 서비스의 **현재 코드와 Runtime OpenAPI**다. 문서가 실제 구현과 어긋나면 변경 내용을 먼저 보고하며, **사용자의 명시적 지시 없이 MD를 자동 갱신하지 않는다.**

## 다음 작업의 기준 상태 (2026-10-25 확인)

이 기록은 develop `0e47eac` 기준이며 이후 작업은 최신 Git/PR과 실행본을 다시 확인한다.

| 영역 | 확인된 구현과 다음 검증 |
|---|---|
| Trading | 방향별 레버리지(#46), 종목별 성과(#48), 영속 가격 위험 작업/계정 복구(#49), 원장 대사(#50)가 병합됨. 누적 대기 이력에서 조회가 느려져 정상 계정 주문·청산도 막히는 문제를 최우선 해결 |
| Content | 인증 계약 보강(#47) 병합. 회원 보안 회귀와 실제 공급자·세 서버 연동을 구분해 검증 |
| Frontend | 방향별 레버리지·성과·복구 연동 작업본 `3b2ba63`은 이 확인 시점에 develop 미병합. 기존 develop Frontend는 side 없는 요청을 사용하므로 최신 Backend와 그대로 조합하지 않음 |

확인 당시 Content133·Trading600·최신 Frontend246개 자동 테스트는 통과했지만 실제 거래 적체가 재현됐다. 이는 운영 준비 완료 선언이 아니다. 수치와 상태는 새 작업에서 재검증한다.

상세 계약과 과거 검증 기록은 각 서비스 README의 링크를 따른다. 기존 `docs/`를 일괄 삭제하지 않는다. 과거 버전 문서의 설명이 최신 승인 계약을 덮어쓰지 않도록 기준 커밋·날짜를 확인한다.
