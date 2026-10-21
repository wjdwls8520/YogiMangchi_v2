# Content Server

Java17 / Spring Boot3.5.16 / Gradle8.14.3 / PostgreSQL / Spring Security / springdoc2.9.1의 독립 Backend다.
현재 구현은 **회원 인증 기반**이며 전체 V1 기능 이식 완료를 의미하지 않는다.
Trading 금융 원장·Frontend를 수정하지 않는다. 회원 JWT의 Trading 계정 연동, Guest JWT 전환,
프로필 변경·탈퇴·이미지·팔로우·커뮤니티는 후속 작업이다.

## 로그인과 토큰 계약

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
| 증명 확인 | GET /api/v1/auth/flow |5분 로그인 증명 세션, SIGNUP_REQUIRED 또는 LOGIN_READY. 미인증401 |
| 신규 가입 | POST /api/v1/auth/signup | nickname,termAgree,privateAgree,선택 profileMessage. 동의 둘 다 true, 닉네임 한글/영문/숫자2~12자. 잘못된 입력400, 중복409 |
| 기존 회원 | POST /api/v1/auth/login/complete | 검증된 증명을 소비하고 JWT JSON+Refresh 쿠키 발급 |
| 갱신 | POST /api/v1/auth/refresh | Refresh 쿠키+CSRF, 새 Access JSON+회전 쿠키. 만료·재사용401 |
| 로그아웃 | POST /api/v1/auth/logout | Refresh 쿠키+CSRF,204. 반복 안전 |
| 본인 프로필 | GET /api/v1/members/me | 자체 Access Bearer, 비활성/잘못된 토큰401. Entity/이메일 직접 노출 없음 |
| 공개키 | GET /.well-known/jwks.json | 공개 RSA 성분만 반환. 개인키 없음 |

발급 응답: `{memberId,nickname,accessToken,tokenType:"Bearer",expiresIn:900,expiresAt}`.
가입/로그인 성공 후 증명은 소비한다. 토큰 응답·프로필·flow·CSRF는 Cache-Control:no-store다.
세션 만료·로그아웃 후 CSRF가 필요하면 `/auth/csrf`를 다시 호출한다.
Frontend에서 공급자 Access Token을 임의로 POST하여 회원이 되는 경로는 없다.

운영 Frontend와 Content API는 HTTPS의 **동일 site** 도메인(예: app.example.com/api.example.com)으로 배치한다.
로컬도 localhost와127.0.0.1을 섞지 않고 동일한 호스트 이름을 사용한다.
Vercel 기본 도메인과 별도 API 도메인은 cross-site여서 Lax 쿠키가 정상 전달되지 않는다.
CORS는 명시한 Origin과 credentials만 허용한다. 이 Backend 작업은 Frontend 코드를 구현하지 않는다.

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

공식 근거: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[Kakao REST](https://developers.kakao.com/docs/ko/kakaologin/rest-api),
[Spring OAuth2 Login](https://docs.spring.io/spring-security/reference/6.5/servlet/oauth2/login/advanced.html),
[Spring CSRF](https://docs.spring.io/spring-security/reference/6.5/servlet/exploits/csrf.html).
