# Content Server

Java17 / Spring Boot3.5.16 / Gradle8.14.3 / PostgreSQL / Spring Security / springdoc2.9.1의 독립 Backend다.
현재 구현은 **회원 인증 기반**이며 전체 V1 기능 이식 완료를 의미하지 않는다.
Trading 금융 원장·Frontend를 직접 수정하지 않는다. 회원 JWT의 Trading 계정 연동은 [Trading 계약](../trading-server/README.md)을 따른다. Guest JWT 전환,
이미지·커뮤니티·팔로우 알림은 후속 작업이다. 기본 프로필·팔로우와 회원 탈퇴/Trading 정리 요청은 구현되어 있다.

## 로그인과 토큰 계약

Frontend 연동 전에는 [인증 오류·쿠키·실제 검증 및 재실행 계약](docs/auth-integration.md)을 확인한다.
신규 오류 코드, 응답 유실 복구, 닉네임 조회429, same-site 지원 조건과 실제 OAuth/브라우저 미검증 범위를 구분한다.

외부 OAuth2는 **Google과 Kakao만** 지원한다. Google은 OIDC sub, Kakao는 사용자 정보 id로 식별한다.
검증된 이메일을 요구하지만 이메일 자체로 계정을 연결하지 않는다. 같은 이메일이라도 다른 공급자 계정은 별개다.
현재 가입 요청은 일반 MEMBER만 생성한다. ID/Password 로그인·추가 공급자·자동 계정 연결을 제공하지 않는다.
Google/Kakao 토큰은 신원 확인에만 사용하고 영속 저장하거나 자체 API 토큰으로 노출하지 않는다.

2026-10-21 사용자 승인 계약:

- Access: Content가 RS256으로 서명한 자체 JWT,15분, JSON 응답. Frontend 메모리에서 보관하고 Bearer로 보낸다.
- JWT: issuer·서명·만료·audience·token_use 검증. sub=memberId, audience=content/trading. 개인 이메일을 넣지 않는다.
- Refresh:256비트 난수, 최초 로그인부터 고정7일. HttpOnly, SameSite=Lax, Path=/api/v1/auth, Domain 없음, 운영 Secure 쿠키.
- PostgreSQL에는 SHA-256 해시만 저장한다. 사용 시 단일 Transaction에서 잠금·ROTATED 처리·후속 토큰 생성.
- 사용된 Refresh를 다시 보내면 해당 family 전체를 REVOKED로 **커밋한 후**401을 반환한다. 클라이언트는 동시 갱신을 하나로 합쳐야 한다.
- Refresh 회전은 최초 만료를 연장하지 않는다. 쿠키 Max-Age도 남은 유효 시간만 반영한다.
- 로그아웃은 family 폐기·쿠키 제거이며 기존 Access의 즉시 폐기를 약속하지 않는다. 기존 Access는 최대15분 유효하다.
- Guest 금융 이력을 회원에게 자동 합치지 않는다. 기존 Trading Guest Bearer는 유지한다.

Refresh/로그아웃/가입/로그인 완료는 세션에 바인딩한 CSRF 검증을 요구한다.
세션은 OAuth state·짧은 로그인 증명·CSRF에 사용하며 **업무 API 로그인 세션으로 신뢰하지 않는다**.
프로필 API는 매 요청 자체 JWT를 검증한다. OAuth 콜백의 성공만으로 가입 동의나 JWT 인증을 생략하지 않는다.

## 브라우저 연동 순서

| 단계 | Endpoint | 계약 |
|---|---|---|
| OAuth 시작 | GET /oauth2/authorization/google 또는 /kakao | 활성화 시에만 제공. state, Google nonce 생성 |
| Provider callback | GET /login/oauth2/code/google 또는 /kakao | Spring Security가 code/state·OIDC를 검증. 고정 Frontend URI로 리다이렉트, URL에 자체 토큰 없음 |
| CSRF 준비 | GET /api/v1/auth/csrf | credentials:include, `{headerName,token}` 반환. 이후 변경 요청에 이 헤더 사용 |
| 증명 확인 | GET /api/v1/auth/flow |5분 로그인 증명 세션, SIGNUP_REQUIRED, LOGIN_READY 또는 WITHDRAWAL_PENDING. 미인증401 |
| 신규 가입 | POST /api/v1/auth/signup | nickname,termAgree,privateAgree,termsVersion,privacyVersion,선택 profileMessage. 동의 둘 다 true, 닉네임 Unicode 문자/숫자1~8 코드 포인트. 잘못된 입력400, 중복409 |
| 기존 회원 | POST /api/v1/auth/login/complete | 검증된 증명을 소비하고 JWT JSON+Refresh 쿠키 발급 |
| 갱신 | POST /api/v1/auth/refresh | Refresh 쿠키+CSRF, 새 Access JSON+회전 쿠키. 만료·재사용401 |
| 로그아웃 | POST /api/v1/auth/logout | Refresh 쿠키+CSRF,204. 반복 안전 |
| 본인 프로필 | GET /api/v1/members/me | 자체 Access Bearer, 비활성/잘못된 토큰401. Entity/이메일 직접 노출 없음 |
| 공개 프로필 | GET /api/v1/members/{memberId} | ACTIVE 회원만 조회, 이메일·권한·공급자 식별자 제외. 미존재/탈퇴404 |
| 닉네임 확인 | GET /api/v1/members/nickname/availability?nickname=... | 공개 사전 확인. 최종 저장 시 DB 고유 제약으로 재검증 |
| 프로필 수정 | PATCH /api/v1/members/me/profile | 본인 Bearer만 허용. nickname/profileMessage 중 하나 이상. 중복409, 검증400 |
| 탈퇴 | POST /api/v1/members/me/withdrawal | 본인 Bearer+최근 동일 OAuth 증명 세션+CSRF+확인 본문.202 PENDING, Trading 확인 후 COMPLETED. GET 동일 경로로 상태 조회 |
| 팔로우/취소 | PUT/DELETE /api/v1/members/{memberId}/follows | 본인 Bearer, 반복 안전. 자기 자신400, 미존재/탈퇴 대상404 |
| 관계/집계 | GET /api/v1/members/{memberId}/follows | 공개 followerCount/followingCount. 선택 Bearer로 followed/follower/mine 확인 |
| 팔로워/팔로잉 | GET /api/v1/members/{memberId}/followers 또는 /followings | 공개 목록. cursorId, size1~10(기본10), keyword12자 이하 |
| 공개키 | GET /.well-known/jwks.json | 공개 RSA 성분만 반환. 개인키 없음 |

발급 응답: `{memberId,nickname,accessToken,tokenType:"Bearer",expiresIn:900,expiresAt}`.
가입/로그인 성공 후 증명은 소비한다. 토큰 응답·프로필·flow·CSRF는 Cache-Control:no-store다.
세션 만료·로그아웃 후 CSRF가 필요하면 `/auth/csrf`를 다시 호출한다.
Frontend에서 공급자 Access Token을 임의로 POST하여 회원이 되는 경로는 없다.

프로필 메시지의 신규 가입·수정 입력은255자까지다. PATCH는 누락/null 필드를 유지하고 빈 문자열/공백 메시지는 비운다.

닉네임 입력은 `^[\p{L}\p{N}]{1,8}$` 규칙이며 JavaScript에서는 `u` 플래그를 사용한다.
특정 언어로 제한하지 않고 Unicode Letter/Number 범주만 허용한다. 공백·특수문자·이모지·제어문자·보이지 않는 구분문자는 거절한다.
길이는 UTF-16 길이/Java String.length가 아닌 Unicode 코드 포인트 기준이다. 보충 평면 문자8개도 허용한다.
가입 DTO/Service, 중복 확인, 프로필 수정 DTO/Service/Entity에 같은 NicknamePolicy를 사용하며 자동 trim/정규화/절단을 하지 않는다.
기존9~12자 닉네임은 조회·로그인·갱신·소개글만 수정할 때 보존한다. 명시적으로 닉네임을 제출하면 기존 값과 같더라도 새 입력 규칙을 적용한다.
DB VARCHAR(12)와 이전 migration은 변경하지 않는다. PostgreSQL 문자 길이는 코드 포인트 기준이므로 보충 평면8자도 저장된다.
검색은 기존 닉네임 지원을 위해 최대12 코드 포인트를 유지한다. 중복 판정은 기존 DB 고유 제약/정확한 저장 문자열 기준이며 새 대소문자 통합이나 Unicode 정규화를 도입하지 않는다.
회원 행 잠금으로 동시 부분 변경의 유실을 방지한다. 기존300자 컬럼과 과거 저장값을 임의로 축소하지 않는다.
과거255자 초과 메시지가 있다면 닉네임 변경 시에도 유효한 메시지를 함께 제출해야 하며 그렇지 않으면409다.
이미지 업로드·다른 회원의 프로필 변경은 제공하지 않는다. CORS는 설정한 Origin의 PATCH preflight를 허용한다.

팔로우는 회원 ID 두 개를 오름차순으로 잠그고 변경하므로 중복·상호 요청과 탈퇴 경합을 직렬화한다.
별도 회원 카운터를 증감하지 않고 ACTIVE 회원 사이의 활성 관계에서 집계한다. 조회는 명시적 JDBC DTO Projection이며
부분 고유 인덱스와 커서 조회를 기존 PostgreSQL/JdbcTemplate로 처리한다. Entity/Querydsl/새 의존성은 추가하지 않는다.
언팔로우는 관계를 비활성화하고 재팔로우는 새 관계 ID를 생성하므로 이전 이력을 보존하면서 최신 순서를 유지한다.
목록은 관계 ID 내림차순이다. 첫 요청은 cursorId 생략, hasNext이면 nextCursorId를 다음 요청에 전달한다.
닉네임 검색은 대소문자를 구분하지 않는 리터럴 부분 검색이며 검색어 변경 시 커서를 초기화한다. `%`를 와일드카드로 해석하지 않는다.
탈퇴는 양방향 관계를 같은 Content Transaction에서 비활성화하며 일반 조회·집계에서 제외한다.
이미지·bestCount·팔로우 알림은 구현하지 않은 값을 응답에 꾸며 넣지 않는다. 알림 저장/전달은 Content 알림 단계에서 연결한다.

## 탈퇴·재가입·동의·회원 계정 생성 계약

최신 계약은 [회원 생애주기](docs/member-lifecycle.md)를 따른다. 기존 무본문 탈퇴 요청은 허용하지 않는다.
탈퇴는 WITHDRAWING/PENDING 접수 → Trading 계정 잠금·금융 정리 커밋/204 → Content 개인정보 파기·WITHDRAWN/COMPLETED 순서다.
PENDING은 탈퇴 확정이 아니다. Trading 확인 전 네트워크 장애를 완료로 표시하지 않는다.
이미 발급된 JWT의 Content 회원 기능은 WITHDRAWING부터 차단하고, Trading은 정리 커밋부터 모든 금융 접근·체결·청산을 차단한다.
확정 뒤에는 새 체결이 발생할 수 없다. 분산 서버 간 한 순간의 원자적 커밋을 약속하지 않는다.

동일 Google/Kakao 계정은 개인정보 파기 완료 후 SIGNUP_REQUIRED로 다시 가입할 수 있다. 반드시 새 memberId를 만들며 이전 금융 이력을 옮기지 않는다.
닉네임은 WITHDRAWN에서 NULL, 프로필 메시지는 빈 문자열이다. OAuthIdentity(이메일/소셜 식별값), 모든 Refresh 인증 기록,
불필요한 동의 이력과 기존 동의 시각은 제거한다. 회원 ID·탈퇴 상태·시각·최소 확인 버전/시각과 거래 참조는 보존한다.
현재 이미지·외부 파일·커뮤니티는 없으므로 그런 데이터를 파기했다고 보고하지 않는다. 다른 기기의 임시 OAuth 증명은 최대5분이며
과거 계정 인증을 복구하지 못한다. 백업/접속 로그 파기는 운영 환경별 별도 확인이 필요하다.

정책 버전은 TERMS=ym-terms-v1, PRIVACY=ym-privacy-v1이다. `/api/v1/policies/current` 및 각 documentUrl에서
동일 버전의 고정된 개발용 초안과 SHA-256을 읽을 수 있다. 운영자/문의처/위탁/보유기간은 운영 전 확정한다.
동의는 가입과 같은 Transaction에서 버전별 서버 시각으로 기록한다. 기존 회원의 미상 버전 동의를 새로 위조하지 않는다.
`GET/POST /api/v1/members/me/consents`로 재동의 상태와 제출을 처리한다. 과거 기록과 최초 동의 시각은 덮어쓰지 않는다.

신규 가입은 `member_trading_provision`에 PENDING 요청을 같은 Transaction으로 저장한다.
기존 Content→Trading 신뢰 URL/서명키와60초 전용 JWT(token_use=member_provisioning)로 회원 계정 생성을 재전송한다.
이 토큰은 탈퇴 API에 사용할 수 없다. Trading의 공개 회원 계정 생성 API도 같은 멱등한 생성 경로를 사용한다.
Content의 `CONTENT_WITHDRAWAL_DELIVERY_ENABLED` 설정이 탈퇴·계정 생성 전달을 함께 활성화한다(운영 기본true).
HTTP는 Content DB Transaction 밖에서 실행하며2초 연결/3초 요청 제한, 지연 재시도 최대300초, 배치10건이다.
Trading이204를 보낸 뒤 Content 업데이트가 실패하면 요청이 남아 재전송된다. 금융 생성/탈퇴는 중복 실행에 안전하다.


## 실행

공용 인프라는 Repository 루트 Compose를 사용한다. 별도 Content Compose나 PostgreSQL Database를 만들지 않는다.
`yogimangchi` Database의 `content` Schema를 Content Flyway만 관리한다. Trading 테이블을 읽거나 쓰지 않는다.
Hibernate는 validate, open-in-view=false이며 운영 migration 계정과 앱 계정은 분리한다.
**최초 실행은 content Schema의 첫 migration을 적용한다. 기존 사용자 DB에는 이번 작업 중 실행하지 않았다.**

환경변수 예시는 루트 `.env.example`을 따른다. Spring Boot는 `.env`를 자동 로드하지 않으므로 IDE 실행 설정 등에 주입한다.

| 환경변수 | 용도 |
|---|---|
| YOGIMANGCHI_DB_USERNAME/PASSWORD/PORT | 로컬 공용 DB 접속 |
| CONTENT_SERVER_PORT | 기본8080 |
| CONTENT_JWT_PRIVATE_KEY_PATH | Repository 밖의 PKCS8 RSA PEM 개인키 파일.2048비트 이상,3072 권장 |
| CONTENT_JWT_KEY_ID | 기본content-1, 공개키 식별자 |
| YOGIMANGCHI_JWT_ISSUER | 로컬 기본http://localhost:8080, 운영 HTTPS 필수 |
| CONTENT_OAUTH_ENABLED | 로컬 기본false, 운영 기본true. false면 OAuth 시작/콜백이 열리지 않음 |
| GOOGLE_CLIENT_ID/SECRET | OAuth 활성화 시 필수 |
| KAKAO_CLIENT_ID/SECRET | OAuth 활성화 시 필수. Kakao 콘솔 Client Secret 활성화 필요 |
| CONTENT_AUTH_RETURN_URI | 고정 Frontend 콜백. 로컬 기본http://localhost:3000/auth/callback, 운영 HTTPS 필수 |
| CONTENT_HTTP_ALLOWED_ORIGINS | 명시적인 Frontend Origin 목록. 운영 필수 |
| CONTENT_WITHDRAWAL_DELIVERY_ENABLED | 로컬 기본false, 운영 기본true. 사용 시 Trading 회원 JWT 검증도 활성화 |
| CONTENT_TRADING_BASE_URL | 로컬 기본http://localhost:8081, 운영 명시 필수. 신뢰한 내부 서비스 주소; 외부망에서는 HTTPS 사용 |
| CONTENT_DB_URL/USERNAME/PASSWORD | 운영 앱 접속, 같은 yogimangchi DB |
| CONTENT_FLYWAY_USERNAME/PASSWORD | 운영 Content migration 계정 |

Java17을 선택하고 `content-server`에서 `./gradlew bootRun --args='--spring.profiles.active=local'`로 실행한다.
운영은 prod Profile을 사용한다. 운영 key/credentials에 기본 Secret이나 실행 중 자동 생성 대체값이 없다.
서명키 교체는 아직 단일 공개키 구조이므로 기존15분 Access 유효 시간과 Trading 키 반영 순서를 고려해야 한다.
실제 Secret·서명키를 `.env.example`이나 Repository에 넣지 않는다.

Google/Kakao 콘솔 Redirect URI는 **실제 외부 Content URL**의 `/login/oauth2/code/google`, `/login/oauth2/code/kakao`를 정확히 등록한다.
역방향 Proxy를 사용하면 신뢰할 수 있는 Proxy 경계에서 외부 host/scheme을 전달하도록 배포 설정을 검토한다.
현재 임시 로그인/CSRF 세션은 한 Content 인스턴스의 메모리다. 재시작 시 재로그인/CSRF 재준비가 필요하며,
다중 인스턴스 전환 때는 세션 공유/라우팅을 먼저 정해야 한다. Refresh 원본은 PostgreSQL이므로 세션 재준비 후 갱신 가능하다.
Provider token/userinfo HTTP는 연결3초·읽기5초 제한이며 OIDC ID Token 검증은 Spring Security 기본 검증기를 유지한다.

## 의존성과 검증

OAuth2 Client는 공급자 code/state/OIDC 처리를 직접 재작성하지 않기 위해 사용한다.
Resource Server는 자체 JWT 검증과 Spring이 제공하는 Nimbus JOSE Encoder/Decoder를 사용하기 위해 추가했다.
JPA/PostgreSQL/Flyway는 회원·Refresh 영속/잠금/고유 제약·버전 migration에 필요하다.
Validation은 가입 입력·동의 검증, springdoc은 실제 API 계약, Testcontainers는 H2로 숨길 수 없는 PostgreSQL 동시성·rollback 검증을 담당한다.
Lombok·Redis·별도 JWT 라이브러리·Authorization Server 제품은 현재 필요하지 않아 추가하지 않는다.
기존 Java17/Boot3.5.x 기준을 유지하며 외부 OAuth 네트워크를 자동 테스트 조건으로 사용하지 않는다.

`./gradlew clean build`로 테스트·빌드한다. 실제 OAuth 콘솔/브라우저 로그인은 Secret과 Frontend 연동 후 별도 검증해야 한다.
2026-10-21 `clean build`와 최종 검수 후 `build` 성공,20개 테스트 통과(실패·오류·건너뜀0).
공급자 ID/이메일 분리, 약관·닉네임·중복/동시 가입 rollback, Refresh 해시·회전·재사용 계열 폐기·동시성,
실제 CSRF 세션 헤더, OAuth state/Google nonce, 프로필 Bearer 제한, JWT 서명 변조·issuer/audience/만료·필수 claim,
본인 로그인 증명 소비와 prod Secure 쿠키/Swagger 차단을 검증했다. Google/Kakao 외부 호출은 mock으로 분리했다.
local Swagger는 `/swagger-ui/index.html`, OpenAPI는 `/v3/api-docs`다. prod에서는 두 endpoint를 차단한다.

2026-10-22 기본 프로필 추가 후 `clean build` 성공,27개 테스트 통과(실패·오류·건너뜀0).
공개/비공개 필드, 본인 소유권, 비활성 회원 제외, 입력·중복 rollback, 동시 부분 변경,
OpenAPI 인증 요구 및 PATCH CORS, 범위를 벗어난 JWT subject의401 응답을 추가 검증했다.

2026-10-22 탈퇴 추가 후 `clean build` 및 최종 `build` 성공,30개 테스트 통과(실패·오류·건너뜀0).
탈퇴 반복/소프트 삭제/모든 Refresh 폐기·쿠키 제거, 회원·Refresh·전송 요청의 원자적 rollback,
HTTP503 재시도 대기/새 worker 재개/전용 JWT 서명·계약/204 완료 처리를 추가 검증했다.

2026-10-22 팔로우 추가 후 clean build 성공,38개 테스트 통과(실패·오류·건너뜀0).
인증·본인 소유권·중복 PUT/DELETE·이력 보존·커서/검색·관계 집계·탈퇴 제외·동시 중복/탈퇴 경합과 OpenAPI/CORS를 검증했다.

공식 근거: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[Kakao REST](https://developers.kakao.com/docs/ko/kakaologin/rest-api),
[Spring OAuth2 Login](https://docs.spring.io/spring-security/reference/6.5/servlet/oauth2/login/advanced.html),
[Spring CSRF](https://docs.spring.io/spring-security/reference/6.5/servlet/exploits/csrf.html).

2026-10-23 회원 생애주기 보강 후 Java17 clean build 성공,97개 테스트 통과(실패·오류·건너뜀0).
버전 동의/가입/outbox 원자성, 기존 미상 동의와 재동의 append, 문서 해시·불변성, 탈퇴 확인/실제 CSRF/본인 OAuth,
Google·Kakao 재가입의 새 ID/닉네임 재사용, 개인정보·Refresh 파기, 동시 signup/refresh·탈퇴, HTTP 생성 전달 재시도와 V3→V4 이관을 검증했다.
실제 외부 OAuth 및 Frontend/Content/Trading 전체 사용자 시나리오는 별도 검증 단계다.

2026-10-24 인증 계약 보강 후 Java17 `clean build` 성공,133개 테스트 통과(실패·오류·건너뜀0).
실제 임시 포트 Tomcat과 로컬 공급자 HTTP/JWK로 Google OIDC 서명·state·nonce·issuer·audience·만료,
가입→갱신→로그아웃→재로그인과 CSRF/쿠키 경로를 검증했다. 안전한 오류 code, 동시 로그인 증명 소비,
닉네임 조회429/Retry-After, DB 장애503, Bearer를 덧붙인 쿠키 요청의 CSRF와 전송204 후 상태 저장 rollback/재전송도 검증했다.
실제 Google/Kakao 계정·브라우저 SameSite/다중 탭·양 서비스 실제 통합은 미검증이며 [연동 확인표](docs/auth-integration.md)를 따른다.
