# Content Server — Agent Instructions

루트 `AGENTS.md`를 함께 따른다. 기본 수정 소유 범위는 `content-server/**`; Trading·Frontend·루트 공통 설정은 별도 승인 없이 수정하지 않는다.

## 책임

- 회원, Google/Kakao OAuth2 로그인, Access/Refresh 인증, 프로필, 팔로우, 동의·탈퇴·재가입, 향후 커뮤니티·뉴스를 소유한다.
- PostgreSQL `content` Schema만 조회·변경한다. Trading 금융 데이터는 직접 접근하지 않고 ID 및 명시적 서비스 간 API/전달 작업으로 처리한다.

## 지켜야 할 조건

- Google OIDC `sub`, Kakao 사용자 ID를 신원 기준으로 사용한다. 이메일 일치만으로 공급자 계정을 자동 연결하거나 비밀번호 인증·새 공급자를 임의 도입하지 않는다.
- 서버에서 OAuth `state`·OIDC `nonce`·서명/신원 검증을 우회하지 않는다. 공급자 토큰을 자체 API Bearer로 사용하지 않는다.
- 회원 Access는 자체 RS256 JWT 15분, Refresh는 고정 7일 HttpOnly 회전 쿠키다. CSRF·세션·토큰 재사용 탐지·토큰 계열 폐기 등 현재 보안 계약을 검증 없이 약화시키지 않는다.
- 다중 탭·동시 Refresh·로그아웃·탈퇴 경합은 기존 테스트와 API 계약을 고려한다. 브라우저 Lock 제거를 전제로 서버 보안을 임의로 완화하지 않는다.
- 탈퇴는 Content의 상태 변경과 Trading의 금융 계정 정리 완료를 구분한다. 실패·재시도·중복 전달에도 최종 상태가 안전해야 한다.
- Guest 금융 이력을 회원 계정과 자동 합치지 않는다. 비밀키, OAuth 토큰, Refresh 원문 및 개인정보를 로그·저장소에 노출하지 않는다.
- 기존 Flyway Migration을 고쳐 쓰거나 운영 사용자 DB를 임의 정리하지 않는다. 테스트에는 격리된 DB와 공급자 Mock을 사용한다.

## 작업 방식

- 기존 코드·테스트·Runtime OpenAPI를 먼저 확인하고 필요한 범위만 변경한다. 불필요한 인증 시스템 재설계를 피한다.
- 인증·탈퇴·가입·재사용 탐지·회원 소유권 변경에는 실패 경로와 동시성 회귀 테스트를 우선 확인한다.
- 실행·API·환경변수 참고: [`README.md`](README.md). 테스트/빌드: `./gradlew clean build`(Docker/Testcontainers 환경 필요 가능).
- Git 브랜치·PR·MD 갱신·파일 소유권은 루트 `AGENTS.md`를 따른다.

## 추가 보안·생애주기 기준

- Access는 issuer/audience/token_use/서명/만료를 검증한다. 개인키를 공개 JWKS에 포함하지 않는다. 운영 쿠키 Secure, Refresh 원문 대신 PostgreSQL 해시 보관, 고정 만료·회전·재사용 계열 폐기·CSRF 계약을 유지한다.
- OAuth 외부 호출을 업무 DB 트랜잭션 안에 넣지 않는다. 공급자/서비스 호출은 시간 제한과 유한 재시도·영속 전달 상태를 사용한다.
- 현재 승인 정책은 탈퇴 전달 중 즉시 Trading 차단을 요구하지 않는다. Content의 WITHDRAWING/PENDING과 최종 COMPLETED를 구분하고 Trading 정리 확인 뒤 최종 처리를 완료한다. 최종 정리·개인정보 파기·재전송 멱등성을 약화시키지 않는다.
- 로그인 완료/재동의 필요/계정 생성 대기/인증 실패를 Frontend가 구분할 수 있게 한다. UI 문제를 이유로 Backend 계약을 임의 변경하지 않는다.
- 자동 Mock/OIDC 검증과 실제 Google/Kakao E2E를 구분한다. 실제 인증·동의가 필요한 단계는 테스트 전용 계정과 사용자 권한 범위에서 수행하며 기존 실제 회원을 임의 탈퇴시키지 않는다.
