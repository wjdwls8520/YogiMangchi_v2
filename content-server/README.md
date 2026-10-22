# Content Server

Java17 / Spring Boot3.5.16 / Gradle8.14.3 / PostgreSQL / Spring Security / springdoc2.9.1의 독립 Backend다.
현재 구현은 **회원 인증 기반**이며 전체 V1 기능 이식 완료를 의미하지 않는다.
Trading 금융 원장·Frontend를 직접 수정하지 않는다. 회원 JWT의 Trading 계정 연동은 [Trading 계약](../trading-server/README.md)을 따른다. Guest JWT 전환,
이미지·커뮤니티·팔로우 알림은 후속 작업이다. 기본 프로필·팔로우와 회원 탈퇴/Trading 정리 요청은 구현되어 있다.

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
| 신규 가입 | POST /api/v1/auth/signup | nickname,termAgree,privateAgree,선택 profileMessage. 동의 둘 다 true, 닉네임 Unicode 문자/숫자1~8 코드 포인트. 잘못된 입력400, 중복409 |
| 기존 회원 | POST /api/v1/auth/login/complete | 검증된 증명을 소비하고 JWT JSON+Refresh 쿠키 발급 |
| 갱신 | POST /api/v1/auth/refresh | Refresh 쿠키+CSRF, 새 Access JSON+회전 쿠키. 만료·재사용401 |
| 로그아웃 | POST /api/v1/auth/logout | Refresh 쿠키+CSRF,204. 반복 안전 |
| 본인 프로필 | GET /api/v1/members/me | 자체 Access Bearer, 비활성/잘못된 토큰401. Entity/이메일 직접 노출 없음 |
| 공개 프로필 | GET /api/v1/members/{memberId} | ACTIVE 회원만 조회, 이메일·권한·공급자 식별자 제외. 미존재/탈퇴404 |
| 닉네임 확인 | GET /api/v1/members/nickname/availability?nickname=... | 공개 사전 확인. 최종 저장 시 DB 고유 제약으로 재검증 |
| 프로필 수정 | PATCH /api/v1/members/me/profile | 본인 Bearer만 허용. nickname/profileMessage 중 하나 이상. 중복409, 검증400 |
| 탈퇴 | POST /api/v1/members/me/withdrawal | 본인 Bearer.202 PENDING 접수, Trading 확인 후 반복 요청200 COMPLETED. 반복 안전 |
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

## 탈퇴 계약

회원은 즉시 WITHDRAWN/withdrawnAt으로 소프트 삭제하고 프로필 메시지를 비운다. 공개 조회·로그인·갱신·프로필 변경을
차단하며 모든 Refresh 계열을 폐기하고 브라우저 Refresh 쿠키와 임시 세션을 제거한다. 회원/OAuth 연결/가입 동의 이력은 물리 삭제하지 않는다. 닉네임은 계속 예약되며,
동일 OAuth 계정의 재가입·개인정보 파기 정책은 이 endpoint에서 임의로 구현하지 않는다.

동일 Transaction에서 `content.member_withdrawal`에 PENDING 요청을 저장한다. Trading DB를 직접 수정하지 않는다.
전송을 활성화하면 최대10건씩 별도 HTTP로 보내고 Trading204 응답 후 COMPLETED로 저장한다.
실패 시5초부터 최대5분 간격으로 재시도하며 재시작 후에도 DB 요청을 이어 처리한다. 중복 전송은 Trading에서 멱등 처리한다.
Content 서명키로60초짜리 전용 JWT(audience=trading-internal, token_use=member_withdrawal, sub=대상 memberId)를 발급한다.
일반 회원/Guest 토큰은 내부 API에서 사용할 수 없다. 토큰·내부 오류 응답 본문을 저장하거나 로그에 남기지 않는다.

Trading은 대기 주문을 취소하고 예약 금액을 해제하며 열린 포지션을 CLOSED/closeReason=MEMBER_WITHDRAWAL로 종료한다.
실시간 시세를 기다리지 않고 Fill·청산가·추가 손익·수수료를 만들지 않는다. 기존 체결/실현 손익/수수료/잔액은 보존한다.
탈퇴 종료는 정상 매매 종료 집계에서 제외하며 계정은 WITHDRAWN으로 유지해 재생성·기존 JWT 사용을 차단한다.
Content 접수와 Trading 완료는 한 Transaction이 아니므로202는 전체 처리 완료를 의미하지 않는다.
전송 전에는 기존 Access로 Trading을 사용할 수 있으며 이 구간은 전송 지연 또는 Access 만료(최대15분)에 영향을 받는다.
탈퇴 후 토큰 만료로 상태 조회가 불가능해져도 영속 전송은 계속된다. 아직 없는 커뮤니티 데이터 삭제는 구현하지 않는다.

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
