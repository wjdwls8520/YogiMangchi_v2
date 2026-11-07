# Content Server

회원 인증과 콘텐츠 도메인을 소유하는 독립 Spring Boot 애플리케이션이다. 현재 `develop`에는 **회원·인증·프로필·팔로우** 기능이 있으며 커뮤니티 게시글·뉴스는 후속 구현 대상이다.

## 기술·경계

- Java 17, Spring Boot 3.5.16, Gradle, Spring Security, JPA, Flyway, PostgreSQL `content` Schema.
- Trading의 주문·잔고·체결 테이블은 직접 접근하지 않는다. 회원 거래 계정 생성/탈퇴 정리는 별도 서비스 API·전달 절차를 사용한다.
- 정확한 버전은 `build.gradle`, 운영 설정은 `src/main/resources/application-prod.yml`을 기준으로 확인한다.

## 인증 계약

- Google OAuth2/OIDC 및 Kakao OAuth2만 지원. 일반 ID/Password 인증 없음.
- Content 자체 RS256 Access JWT: 15분, Frontend 메모리 보관, `Authorization: Bearer`로 제출.
- Refresh: 최초 로그인 기준 고정 7일, HttpOnly/SameSite=Lax(운영 Secure) 쿠키, `/api/v1/auth` 경로, 사용 시 회전. DB에는 토큰 해시 저장.
- OAuth·CSRF 임시 세션과 API Bearer 인증은 서로 다른 개념이다. 쿠키 관련 변경 요청은 CSRF 보호를 따른다.
- 다른 공급자 계정을 이메일만으로 자동 연결하지 않으며 Guest 금융 이력을 합치지 않는다.
- Refresh 동시성·로그아웃·다중 탭 정책은 현재 코드와 테스트를 확인한다. 유효한 기존 Access는 로그아웃 이후 최대 15분 남을 수 있다.

## 주요 API (요약)

| 영역 | 메서드·경로 |
|---|---|
| OAuth 시작 | `GET /oauth2/authorization/google`, `/kakao` |
| OAuth 결과 후 흐름 | `GET /api/v1/auth/flow` |
| CSRF 토큰 | `GET /api/v1/auth/csrf` |
| 가입·로그인 완료 | `POST /api/v1/auth/signup`, `/api/v1/auth/login/complete` |
| Refresh·로그아웃 | `POST /api/v1/auth/refresh`, `/api/v1/auth/logout` |
| 내 프로필·변경 | `GET /api/v1/members/me`, `PATCH /api/v1/members/me/profile` |
| 공개 프로필·닉네임 | `GET /api/v1/members/{memberId}`, `GET /api/v1/members/nickname/availability` |
| 팔로우·조회 | `PUT/DELETE /api/v1/members/{memberId}/follows`, 관련 목록·집계 GET |
| 탈퇴 요청·상태 | `POST/GET /api/v1/members/me/withdrawal` |
| 공개 검증키 | `GET /.well-known/jwks.json` |

가입은 버전별 약관·개인정보 동의를 기록한다. 탈퇴는 `WITHDRAWING` 요청을 영속화하고 Trading 정리 확인 후 `COMPLETED`로 확정하는 비동기 흐름이다. 재가입은 새 회원 신원으로 취급하며 이전 금융 기록을 자동 복구하지 않는다.

## 실행·검증

공용 PostgreSQL과 Redis는 루트 `docker-compose.yml`에서 실행한다. 예시 환경변수는 루트 `.env.example`을 확인한다. Spring Boot는 루트 `.env`를 자동 로드하지 않으므로 실행 환경에 값을 주입한다.

주요 환경변수: `YOGIMANGCHI_DB_USERNAME/PASSWORD/PORT`, `CONTENT_SERVER_PORT`(기본 8080), `CONTENT_JWT_PRIVATE_KEY_PATH`, `CONTENT_JWT_KEY_ID`, `YOGIMANGCHI_JWT_ISSUER`, `CONTENT_OAUTH_ENABLED`, Google/Kakao 클라이언트 키, `CONTENT_AUTH_RETURN_URI`, `CONTENT_HTTP_ALLOWED_ORIGINS`, `CONTENT_WITHDRAWAL_DELIVERY_ENABLED`, `CONTENT_TRADING_BASE_URL`.

```bash
# content-server/ 내부, Java 17 및 필수 환경변수 구성 후
./gradlew bootRun --args='--spring.profiles.active=local'
./gradlew clean build
```

운영은 별도 `prod` 설정을 적용한다. 로컬 테스트는 OAuth 실제 외부 접속 없이 Mock과 Testcontainers를 사용하며, 실제 공급자 인증·세 서버 통합은 별도 E2E로 검증한다. 개발용 `/v3/api-docs`·Swagger UI는 운영에서 비활성화한다.

작업 불변조건과 Git 정책은 [`AGENTS.md`](AGENTS.md), [`../AGENTS.md`](../AGENTS.md)를 따른다. 코드·Runtime OpenAPI와 설명이 충돌하면 보고하고 승인 없이 문서를 자동 갱신하지 않는다.

## 상세 계약과 검증 범위

- [인증·오류·Frontend 연동](docs/auth-integration.md)
- [정책 동의·가입·탈퇴·재가입·Trading 전달](docs/member-lifecycle.md)
- 현재 정책/원문: `GET /api/v1/policies/current`. 본인 동의 조회·제출: `GET/POST /api/v1/members/me/consents`.
- 회원 탈퇴는 본인 Bearer, 최근 동일 회원 OAuth 증명, CSRF와 확인 본문이 필요하다. 최종 Trading 정리 전 완료로 안내하지 않는다. 전파 중 즉시 Trading 차단은 제품 요구가 아니다.
- 가입/Trading 생성 전달 재전송에서 초기 자금이 중복 지급되면 안 된다. 기존 Guest 자산이나 과거 회원 이력을 새 회원에게 자동 연결하지 않는다.
- 브라우저 회원 인증은 Frontend·Content·콜백의 호스트/사이트를 일관되게 설정한다. 로컬에서도 localhost와127.0.0.1 혼용은 쿠키 동작에 영향을 줄 수 있다. Origin을 바꾸어도 보안 검증을 끄지 않는다.
- 2026-10-25 확인 당시 자동 테스트133개 통과. 실제 Google/Kakao 신규 가입부터 최종 탈퇴까지 전체 E2E 완료를 뜻하지 않는다. 다음 작업은 실제 회원 연동과 발견된 결함의 수정이며 무조건적인 인증 시스템 재설계가 아니다.
