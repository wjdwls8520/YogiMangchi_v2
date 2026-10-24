# Content 인증 연동·검증 계약 (2026-10-24)

## 변경 범위와 유지 계약

기준: develop `4c6800c`, 작업 브랜치 `codex/content-auth-contract`. 변경은 content-server 안에만 있다.
기존 OAuth/회원/동의/탈퇴/전송 큐를 재사용한다. Trading JWT claim·내부 API·금융 정책은 바꾸지 않는다.
Google OIDC sub와 Kakao id로 계정을 구분하며 이메일 자동 연결과 Guest 금융 이력 병합은 없다.
Access 15분 JSON/Frontend 메모리, Refresh 최초 로그인부터 고정7일/해시 저장/회전/재사용 family 폐기,
Member→Refresh 잠금 순서, 실패 Refresh의 Set-Cookie 없음, 로그아웃과 경합한 후속 토큰 폐기를 유지한다.

쿠키 API는 `/api/v1/auth/csrf`로 세션 헤더를 준비하고 credentials:include로 호출한다.
`/api/v1/auth/**`는 Bearer 인증을 사용하지 않으므로 불필요한 Authorization 헤더로 CSRF가 생략되지 않는다.
탈퇴는 기존 Bearer+동일 회원의 최근 OAuth 증명+CSRF 계약이다. Access 즉시 폐기를 약속하지 않는다.

## Frontend에 전달할 오류 계약

API는 기존 application/problem+json `{type,status,code,detail,...}` 구조를 유지한다.
code로 분기하고 detail/공급자 원문/내부 예외를 사용자에게 표시하지 않는다. 오류는 no-store다.
여러 입력이 틀리면 첫 오류 하나를 반환한다. 다음 목록은 인증/가입 관련 코드이며 모든 Content 오류의 전체 목록은 아니다.

| HTTP / code | 의미와 안전한 다음 행동 |
|---|---|
|400 INVALID_NICKNAME|Unicode 문자/숫자1~8 코드 포인트로 수정한다. 자동 trim/정규화 없음|
|409 NICKNAME_UNAVAILABLE|다른 닉네임 선택. 사전 availability 성공은 저장 예약이 아님|
|400 INVALID_REQUEST / INVALID_PROFILE|입력/본문/프로필 형식을 확인한다|
|400 REQUIRED_CONSENT_MISSING|두 필수 동의를 확인한다. 서버에서 대신 동의하지 않음|
|400 POLICY_VERSION_REQUIRED|current와 원문을 조회하고 버전을 제출한다|
|409 POLICY_VERSION_CHANGED|선택을 초기화하고 최신 원문을 읽은 뒤 명시적으로 다시 동의한다|
|409 MEMBER_ALREADY_EXISTS|동일 공급자 계정이 이미 가입됨. flow 조회 후 LOGIN_READY이면 login/complete, 증명 소실이면 새 OAuth|
|409 RESOURCE_ALREADY_EXISTS|기타 고유 제약 충돌. 상태 확인 후 진행하며 가입 무한 재시도 금지|
|409 MEMBER_BUSY|회원 작업이 잠금 경합 중. 요청 결과가 확실히409일 때 잠시 후 사용자 재시도. 응답 유실과 혼동하지 않음|
|401 LOGIN_PROOF_EXPIRED|5분 로그인 증명 만료. 새 소셜 인증 필요|
|401 LOGIN_PROOF_REQUIRED|증명 없음/소비됨/임시 세션 소실. 이미 성공했는지 확인하고 필요 시 새 OAuth|
|401 AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN|Refresh 또는 Access가 없거나 만료/무효. Refresh 재사용 여부는 외부에 세분화하지 않음|
|401 MEMBER_NOT_ACTIVE|Content 회원 기능을 이용할 수 없는 상태. 탈퇴 접수 상태를 일반 로그인 만료로 복구하지 않음|
|403 CSRF_INVALID|auth 쿠키 요청의 세션/헤더 재준비. 변경 요청의 응답 유실이었다면 먼저 결과 확인|
|403 ACCESS_DENIED|권한 거절. 기존 탈퇴 전용 CSRF 거절도 이 코드를 유지함|
|429 RATE_LIMITED|닉네임 조회만 Retry-After 초 대기. 로그인 전체를 해제하거나 Refresh 재요청하지 않음|
|503 SERVICE_TEMPORARILY_UNAVAILABLE|DB 접속/Transaction 시작 장애. 인증 만료로 간주해 토큰/로그인 쿠키를 삭제하지 않음|
|500 INTERNAL_ERROR|안전한 일반 오류. 성공 여부가 불분명한 변경은 자동 반복하지 않음|

과거 `POLICY_VERSION_OR_CONSENT_INVALID`는 이 서버에서 위 세 정책/동의 코드로 분리한다.
현재 Frontend `features/member/api/client.ts`의 허용 목록은 신규 코드가 없으므로 후속 Work에서 추가해야 한다.
새 code를 모르는 클라이언트는 HTTP 상태 기반의 기존 일반 안내로 동작한다. 상태/성공 응답 DTO는 유지한다.
기존 `NICKNAME_UNAVAILABLE`, `MEMBER_BUSY`도 사용자 행동을 구분해 표시해야 한다.

OAuth 콜백은 고정 `CONTENT_AUTH_RETURN_URI` 또는 여기에 아래 `?error=` 하나만 붙여 리다이렉트한다.
외부 공급자 콜백의 code/state는 Content에서 소비하며 Frontend 콜백 URL에 토큰·이메일·공급자 subject를 넣지 않는다.

| error 값 | 의미 / 다음 행동 |
|---|---|
|oauth_cancelled|공급자에서 로그인/동의를 취소. 사용자 선택으로 다시 로그인|
|oauth_temporarily_unavailable|공급자 token/userinfo HTTP 일시 실패. 잠시 후 새로운 OAuth 시작; 이전 code 재전송 금지|
|verified_email_required|검증된 이메일 조건 미충족. 공급자 계정/이메일 제공 동의 확인. 무조건 재시도하지 않음|
|oauth_session_expired|state 불일치, 임시 세션 소실, 소비된 콜백. 새 로그인 시작; 반복되면 cookie/site 설정 확인|
|oauth_invalid_response|ID Token 검증 실패(서명/nonce/issuer/audience/만료 등). 인증을 진행하지 말고 새 로그인 또는 운영 점검|
|oauth_failed|기타 안전한 일반 실패. 공급자 원문을 화면에 표시하지 않음|

위 URL 값은 화면 안내용이며 신원 증명이 아니다. 직접 입력한 error로 가입/로그인을 허용하지 않는다.
Kakao는 숫자 id와 이메일 존재/is_email_valid=true/is_email_verified=true를 요구한다.
Google은 Spring 기본 OIDC 검증 후 email_verified=true와 이메일 존재를 요구한다.

## 응답 유실과 여러 탭

- 가입/로그인 성공은 proof를 소비한다. 같은 세션의 `/auth/flow`가 LOGIN_PROOF_REQUIRED여도 가입 실패를 뜻하지 않는다.
  유효한 메모리 Access가 있으면 `/members/me`로 상태 확인. 없으면 새 OAuth 후 flow→LOGIN_READY→login/complete로 복구한다.
  새 OAuth 뒤 SIGNUP_REQUIRED면 가입이 커밋되지 않은 상태이므로 정책/닉네임을 확인해 제출한다.
- Refresh 회전 응답 유실은 쿠키 수신 여부를 확정하기 어렵다. 과거 Refresh를 재전송하면 family가 폐기될 수 있다.
  자동 무한 재시도하지 말고 새 소셜 로그인으로 새 family를 발급한다. 실패 Refresh는 새 로그인 쿠키를 삭제하지 않는다.
- 로그아웃은 family 단위로 반복 안전하지만 유실 후 새 로그인과 뒤섞인 재시도는 새 쿠키를 지울 수 있다.
  탭 간 쿠키 작업을 직렬화하고 진행 중인 작업이 끝난 뒤 로그인한다.
- `navigator.locks`를 제거하지 않는다. 동일 Frontend origin/브라우저 프로필에서 cookie 작업을 직렬화해야 한다.
  다른 Frontend origin은 Web Lock을 공유하지 않는다. 하나의 Content 쿠키를 여러 독립 Frontend origin이 동시에 쓰는 구성은 지원을 검증하지 않았다.
  Web Locks 사용 가능한 secure context(HTTPS, 신뢰되는 localhost)와 지원 브라우저가 필요하다. 미지원 환경을 무잠금 갱신으로 대체하지 않는다.

## Origin / site / 쿠키 지원 조건

| 접속 구성 | 현재 SameSite=Lax 계약 |
|---|---|
|http://localhost:3000 → http://localhost:8080|origin은 다르나 같은 site. 명시 CORS+credentials:include+CSRF 필요. 포트를 쿠키 격리 경계로 생각하지 않음|
|https://app.example.com → https://api.example.com|다른 origin / 같은 schemeful site. host-only 쿠키는 API 호스트에만 보내며 Domain 공유 불필요. HTTPS, 정확한 CORS, credentials, CSRF 필요|
|https://project.vercel.app → https://api.example.com|다른 site. Lax 쿠키는 cross-site fetch에 전송되지 않으므로 현재 계약으로 지원하지 않음. CORS 허용만으로 해결 불가|
|localhost ↔ 127.0.0.1 또는 http ↔ https|서로 다른 site로 취급될 수 있다. 로그인 시작/콜백/API host·scheme을 일관되게 사용|

OAuth 공급자→Content의 최상위 GET callback은 Lax 쿠키가 전송될 수 있는 경로다.
하지만 Frontend로 돌아간 뒤 API fetch는 별개다. OAuth 성공 redirect만 보고 쿠키 통합 성공으로 판단하지 않는다.
Refresh는 Path=/api/v1/auth, CONTENT_SESSION은 Path=/, 모두 HttpOnly/Lax/host-only, prod에서는 모두 Secure다.
CSRF 값은 매 세션 재준비한다. OAuth 성공의 session id 교체와 재시작 후 세션 소실도 확인해야 한다.
단일 인스턴스 메모리 세션이므로 다중 Content 인스턴스는 별도 세션/라우팅 설계 전 지원을 주장하지 않는다.
이번 작업은 SameSite/Secure/CSRF 완화, wildcard CORS/redirect, 배포 구성 변경을 하지 않는다.

근거: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie),
[MDN Fetch credentials](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch),
[Spring OIDC 검증](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/advanced.html),
[Kakao 사용자 정보](https://developers.kakao.com/docs/ko/kakaologin/rest-api).

## 정책 상태와 Trading Integration Note

현재 TERMS/PRIVACY 원문은 DEVELOPMENT_DRAFT다. 불변 버전·SHA-256·append 동의 이력·가입/재동의 Transaction은 유지한다.
최종 정책 원고, 운영 주체/연락처/시행일/보유기간 등은 제공되지 않아 미정이다. 정식 정책 발행 완료로 표시하지 않는다.
`reconsentRequired`는 상태 API와 Frontend UX 조건이다. Content는 재동의 전 회원 전체를 차단하지 않으며
Trading은 이 값을 주문 허용 조건으로 검증하지 않는다. UI의 회원 거래 연결 중단을 서버 강제로 설명하면 안 된다.

향후 제품 합의로 서버 강제가 필요하면 Trading 소유의 동의 적격성 projection을 명시적 이벤트/스냅샷 API로 갱신하고,
버전·재전송 멱등키·조회 복구·지연 중 허용 정책을 양쪽 Work가 먼저 합의하는 방식을 제안한다.
매 주문 Content 조회나 DB 공유는 하지 않는다. 이번에는 해당 프로토콜/신규 필수 JWT claim을 구현하지 않는다.

기존 회원 provisioning: 가입과 PENDING 저장 원자적 →60초 member_provisioning JWT→
`POST /internal/v1/members/{id}/trading-account`→Trading 커밋/204→Content COMPLETED.
재로그인은 provisioning enqueue를 반복하지 않는다. 204 이후 Content 저장 실패는 영속 PENDING/재시도로 복구한다.
Trading은 같은 memberId 반복 생성 시 추가 지급 없이 같은 계정을 유지하고, WITHDRAWN을 재활성화하지 않아야 한다.
현재 Trading 코드/기존 테스트에서 해당 멱등 경로를 읽어 확인했지만 이번 Content 빌드에서 Trading 테스트를 실행한 것은 아니다.
Content mock204 테스트만으로 실제 Trading 금융 멱등성을 검증했다고 보고하지 않는다.

탈퇴는 기존 PENDING→Trading 정리/204→Content 최종 개인정보 정리 순서를 유지한다.
전파 전 Trading 거래 가능 지연은 승인 정책이며 즉시 동결/전파 단축/장기 조회 인증을 추가하지 않는다.
최종 정리/동시 재가입은 새 memberId를 사용하며 과거 금융 계정을 되살리지 않는다. Guest는 별도 주체다.
Trading Work 후속 확인: Guest 공개 생성 남용 제한은 Trading 소유이므로 해당 Work에서 별도 평가한다.

## 최소 남용 방어와 운영 한계

기존 공개 닉네임 조회에는 제한이 없었다. 이 조회만 네트워크 peer당 기본300회/60초로 제한한다.
닉네임 입력 debounce와 결과 캐시를 권장한다. 공유망 때문에 낮은 로그인 차단 한도를 적용하지 않는다.
OAuth 시작/콜백·가입/로그인 완료·Refresh/로그아웃은 이 제한 대상이 아니다. 가입은 기존5분 공급자 증명/성공 후 소비/DB 고유 제약으로 보호한다.
제한 키는 프로세스 임의 salt+peer 주소의 SHA-256으로 메모리에만 보관하고 토큰·이메일·닉네임·IP 원문을 저장/로그하지 않는다.
availability는 사전 안내다.429가 가입 자체의 차단을 의미하지 않으며 최종 제출에는 기존 DB 고유 검사가 계속 적용된다.
키 최대10000개, 만료 후 회수, 가득 차면 새 peer 조회도 최대60초429다. 서버 재시작 시 초기화되는 단일 인스턴스의 최소 방어이며 DDoS/분산 제한이 아니다.
Forwarded/X-Forwarded-For를 직접 신뢰하지 않는다. 신뢰 프록시 미설정 시 여러 사용자가 프록시 peer 한도를 공유할 수 있다.
운영 프록시가 임의 헤더로 remoteAddr를 바꾸지 않도록 신뢰 경계를 확인하고 정상 공유망 트래픽에 맞게 한도를 조정한다.

## 실행·migration·환경변수

새 migration/신규 라이브러리는 없다. Flyway V1~V4와 기존 Java17/Boot3.5.16을 유지한다.
V4를 이미 적용했다면 이번 코드 재시작에 추가 SQL이 없다. V4 미적용 환경은 기존 [V4 배포 절차](member-lifecycle.md#v4-배포와-복구)를 먼저 검토한다.
V4의 개인정보 파기는 애플리케이션 재배포만으로 복구되지 않으므로 실제 사용자 DB에 자동 실험하지 않는다.

추가 선택 설정: `CONTENT_NICKNAME_LOOKUPS_PER_MINUTE=300` (양의 정수, 명시적으로 낮출 때 공유망 영향 검토).
기존 필수 설정과 의미는 [README](../README.md#실행)를 따른다. OAuth 실제 검증에는 아래가 필요하다.

- Repository 밖 RSA 개인키 `CONTENT_JWT_PRIVATE_KEY_PATH`, issuer, kid와 Trading 공개키 일치.
- Google/Kakao 콘솔 client ID/secret, Google OIDC와 Kakao account_email 동의 설정 및 Client Secret 활성화.
- `CONTENT_OAUTH_ENABLED=true`, 정확한 Content 외부 URL의 `/login/oauth2/code/google`·`/kakao` redirect URI.
- 정확한 Frontend `CONTENT_AUTH_RETURN_URI`와 `CONTENT_HTTP_ALLOWED_ORIGINS`, 지원되는 same-site HTTPS 구성.
- 공용 로컬 DB 접속 설정 또는 prod의 앱/Flyway 별도 계정. 전송 검증에는 신뢰한 `CONTENT_TRADING_BASE_URL`과
  `CONTENT_WITHDRAWAL_DELIVERY_ENABLED=true`, Trading 내부 전용 credential 검증 활성화.

재실행은 이 Work의 `content-server` 디렉터리에서 Java17을 선택한 뒤 필요한 환경변수를 IDE/프로세스에 주입하고
`./gradlew.bat bootRun --args='--spring.profiles.active=local'` (Windows), 또는 `./gradlew bootRun --args='--spring.profiles.active=local'`로 실행한다.
prod는 prod profile/HTTPS·Secure 설정을 사용한다. 서버 재시작 후 OAuth 임시 증명과 CSRF는 새로 준비한다.
실행 포트와 해당 브랜치/커밋을 확인하고 다른 Work의 서버를 중지하거나 대신 실행하지 않는다.

## 검증 경계와 Frontend 실제 확인표

자동 검증은 임시 PostgreSQL17.11 Testcontainers와 로컬 mock 공급자만 사용한다.
2026-10-24 Java17 `clean build`:133개 통과, 실패·오류·건너뜀0. 테스트는 이 Work 전용 브랜치에서 실행했다.
`OidcHttpIntegrationTests`는 실제 임의 포트 Tomcat/Java HTTP cookie jar/기본 Spring OIDC 검증기를 실행한다.
이 HTTP client는 브라우저의 SameSite/CORS/Web Locks 정책을 구현하지 않으므로 브라우저 검증으로 세지 않는다.
서버는 테스트 종료 후 종료한다. 사용자 DB/Volume/실제 OAuth Secret과 기존8080 서버는 변경하지 않는다.

| 시나리오 | 이번 검증 / 실제 Frontend 기대 결과 |
|---|---|
|Google state·nonce·서명·issuer·audience·만료|실제 HTTP와 로컬 JWK/서명 토큰으로 정상/거절 자동 검증. 실제 Google 계정은 미검증|
|Kakao id·이메일 조건·취소/오류|기존 단위/콜백 mock 회귀. 실제 Kakao token/userinfo HTTP와 콘솔 동의 화면은 미검증|
|가입·동의·계정 생성 요청 원자성|임시 PG rollback/동시 가입/불변 문서·해시/동의 append/재로그인 큐 불증가 검증|
|가입/로그인 증명 소비와 응답 유실|HTTP·MVC에서 중복 거절/새 OAuth 증명으로 LOGIN_READY 복구. 화면은 무조건 가입 재시도 금지|
|Refresh·로그아웃·탈퇴 경합|기존 PG 잠금·후속 폐기·지연401 Set-Cookie 없음 회귀. 실제 탭2개/동시 활성화/로그아웃 경합은 브라우저 미검증|
|최종 탈퇴·재가입|임시 PG/mock Trading ack로 개인정보 정리/재전송/새 ID/과거 ID 불활성 회귀. 실제 서비스 양쪽 금융 정리는 미검증|
|204 뒤 Content 저장 rollback|실제 mock HTTP204 후 PG 상태 저장 rollback을 주입, PENDING·attempts·새 worker 재전송/완료 검증|
|새로고침·Access15분/Refresh7일 만료|서버 만료/회전 계약 자동 검증. 실제 화면 새로고침·백그라운드 복귀·장시간 만료는 브라우저 미검증|
|OAuth 임시 세션·CSRF·Secure·CORS|실제 HTTP 세션/쿠키/CSRF와 MVC 허용/거절·prod Secure 설정 검증. HTTPS same-site와 cross-site 브라우저 차이는 미검증|
|공급자 응답/콜백·회전 응답 유실|실패·유실을 자동 시뮬레이션. 실제 브라우저 네트워크 차단 시 기존 세션 보존/새 로그인 안내 필요|
|429/503|안전 code/no-store/Retry-After 및 오류 때 쿠키 미변경 자동 검증. UI에서503을 로그아웃으로 처리하지 않아야 함|

Frontend Work는 실제 Google/Kakao 각각 신규/기존 회원, 동의 거절, 검증 이메일 미충족, 콜백 세션 만료,
새로고침, 탭2개 활성/비활성 전환,15분/7일 만료, 네트워크 응답 유실, logout→새 로그인 순서를 지원 브라우저에서 확인한다.
지원 HTTPS same-site와 불지원 cross-site 구성을 따로 기록하고 브라우저 버전/URL/site/쿠키 차단 사유를 남기되 토큰 원문은 남기지 않는다.
