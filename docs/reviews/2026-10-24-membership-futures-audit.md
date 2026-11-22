# 회원 생애주기·선물 모의투자 운영 완성도 검토

검토일: 2026-10-24 KST · 기준 커밋: `4c6800c` · 검토 시작 시 작업 트리 변경 없음.

애플리케이션 코드, SQL migration, Frontend 계약, 자동 테스트를 확인했다. 인프라 운영, 실제 자금 보관·출금, 규제 준수 수준은 평가하지 않았다. 기능을 수정하는 작업이 아니라 현재 상태와 보강 순서를 판단하는 검토다.

## 1. 결론과 점수의 의미

**회원 기능 82/100, 요청한 선물 거래 경험 전체 76/100으로 평가한다.**

회원 인증과 금융 원장의 기본 설계는 탄탄하다. 일반적인 정상 흐름만 만든 MVP보다 높은 수준이며, 중복 실행·경합·rollback을 상당 부분 검증했다. 그러나 가격 이력 단절 시 처리 계약, 탈퇴의 서비스 간 차단 시점, 방향별 레버리지, 성과 포트폴리오와 실제 통합 검증이 남아 있다. 현재 상태를 “운영 준비 완료”로 판정하지 않는다.

점수는 아래 배점으로 산정한 **공학적 검토 점수**다. 결함이 없을 확률, 거래 성공률, 실제 서비스 가용률 또는 코드 커버리지 82%/76%라는 뜻이 아니다. 약 ±5점의 판단 여지는 있으며, 중요한 미해결 항목은 총점과 별개로 출시 조건으로 본다. 실제 운영 부하 수치를 측정하지 않았으므로 TPS·최대 동시 사용자·체결 지연을 추정 실측값처럼 제시하지 않는다.

### 회원 기능 배점

| 평가 항목 | 배점 | 획득 | 근거 |
|---|---:|---:|---|
| 소셜 확인·가입·동의·중복 방지 | 20 | 18 | 공급자 식별자, 버전 동의, 고유 제약과 가입 원자성 구현. 정책 문서는 아직 개발 초안 |
| 로그인·JWT·Refresh·로그아웃 | 25 | 23 | 자체 JWT, 고정 만료·회전·재사용 탐지·CSRF·탭 간 직렬화. 실제 공급자 통합 검증 미완 |
| 회원/Guest 소유권·서비스 경계 | 15 | 14 | memberId 기반 계정 분리, Guest 자동 병합 금지. Guest opaque Bearer는 최종 JWT 통합 전 단계 |
| 탈퇴·재가입·실패 복구 | 25 | 17 | 영속 전달 요청, 멱등 정리, 개인정보 파기와 새 ID 재가입. 전파 전 거래 창과 장기 PENDING 복구 UX 부족 |
| 사용자 경험·오류·통합 검증 | 15 | 10 | 확인 입력·진행 상태 구분 구현. 실제 전체 흐름 검증과 일부 오류 구분·브라우저 계약 보강 필요 |
| **합계** | **100** | **82** | |

### 선물 거래 배점

| 평가 항목 | 배점 | 획득 | 근거 |
|---|---:|---:|---|
| 시장가 진입·포지션·부분/전체 종료 | 15 | 14 | 서버 Mark, 원자적 체결, 평균 단가·부분 청산·멱등 처리 |
| 지정가 탐색·체결·누락 복구 | 20 | 15 | 범위 조건·Stream·checkpoint·재처리 구현. 유실/만료된 crossing은 복원 불가 |
| 자금·수수료·동시성 | 15 | 14 | 계정 DB 잠금, 수수료 포함 예약·재검증, 분리 원장과 경합 테스트 |
| 격리 청산·실시간 손익·예상 청산가 | 15 | 13 | 독립 담보, 청산 비용, 실제 손익/초과손실 조정 분리. 장애 중 위험 통과는 별도 해결 필요 |
| 레버리지 및 요청한 방향별 독립 설정 | 15 | 7 | 공유 설정의 계산·경합은 구현. LONG/SHORT 독립 계약은 미구현 |
| 자산 포트폴리오·성과 의미 | 10 | 5 | 현재 보유 종목별 증거금 배분 구현. 거래한 전체 종목의 성과 분석 미구현 |
| 알림·오류 전달·통합 검증 | 10 | 8 | 영속 이벤트+WS 재개 및 안전한 오류 표시. 거절 이유 누락과 실제 E2E 검증 부족 |
| **합계** | **100** | **76** | |

공통 결함은 관련 항목에 한정해 반영했다. 예를 들어 복구 중 crossing 유실은 주로 지정가/복구 항목의 감점 이유다. 독립 레버리지와 성과 포트폴리오는 현재 정책이 잘못 구현된 버그라기보다, 이번 요청과 기존 제품 계약 사이의 차이다.

## 2. 이번에 실제 검증한 내용

| 대상 | 실행 | 결과 |
|---|---|---|
| Content | `gradlew.bat test bootJar --rerun-tasks --console=plain` | 107개, 실패 0·오류 0·skip 0, 빌드 성공 |
| Trading | 위와 동일 | 557개, 실패 0·오류 0·skip 0, 빌드 성공 |
| Frontend | `npm test` | 237개, 실패 0·skip 0 |
| Frontend | `npm run typecheck`, `npm run lint` | 성공 |
| Frontend 기본 빌드 | `npm run build` | Turbopack 내부 오류로 실패. 권한 범위를 넓힌 재실행도 동일 |
| Frontend 대체 빌드 | `next build --webpack` | 컴파일·타입 검사·페이지 생성 성공 |

**현재 코드의 자동 테스트 총 901개가 통과했다.** 기존 테스트를 재실행한 결과이며 이 검토에서 새 테스트를 추가한 것은 아니다. PostgreSQL/Redis 통합 테스트는 Testcontainers의 임시 인스턴스를 사용한다. 실제 사용자의 로컬 업무 DB를 변경하지 않았다.

기본 프론트 빌드 오류는 `/icon.svg/route` 생성 과정의 CSS/PostCSS 하위 프로세스 연결 실패였다. Webpack 성공은 소스의 일반적인 컴파일 가능성을 뒷받침하지만, 기본 빌드 실패까지 해결되었다는 뜻은 아니다. 제품 금융 로직 결함으로 단정하지 않고 빌드 검증 제한으로 기록한다.

검증 강도를 구분한다.

- **코드+테스트 확인:** 중복 주문, 부분 종료, 수수료, rollback, 여러 경합 시나리오, 회원/Refresh/탈퇴의 DB 처리.
- **코드 경로 확인:** 전파 전 JWT 허용 창, 오래된 이벤트 건너뛰기, 공유 레버리지, 포트폴리오 집계 정의, 거절 사유 미표시. 실제 사용자 환경에서 해당 장애를 새로 재현한 결과와는 구분한다.
- **이번에 미검증:** 실제 Google/Kakao 콘솔 및 브라우저 로그인, Content→Trading→Frontend를 모두 연결한 전체 사용자 시나리오, 장시간 시세 수신·부하·장애 복구 실험, 실제 쿼리 실행계획/지연 분포.

README의 과거 테스트 개수나 “미구현” 설명을 현재 상태로 그대로 사용하지 않았다. 현재 코드는 레버리지 1~100배, 회원 최초 모의자금/회차, Guest 재도전, 개인 체결 WS, 실제 체결·종료 포지션 이력을 이미 제공한다. 루트/Frontend README의 이전 20배 상한·알림/종료이력 미제공·회원 잔액 0 등의 설명과 차이가 있다. 실행 코드와 migration, 최신 테스트가 판단 기준이다.

## 3. 회원가입 → 로그인 → 탈퇴

### 3.1 가입

현재 흐름은 Google/Kakao OAuth → 서버의 5분짜리 로그인 증명 → 신규/기존 회원 구분 → 닉네임·필수 정책 버전 동의 → 회원·OAuth 연결·동의 이력·Trading 계정 생성 전달 요청 저장 → 자체 토큰 발급이다.

잘 구현된 부분:

- 공급자의 `provider + subject`로 회원을 식별한다. 이메일이 같다는 이유로 Google과 Kakao 계정을 합치지 않는다.
- Google의 검증된 이메일과 Kakao의 이메일 유효/검증 상태를 확인한다. 공급자 토큰을 자체 API 인증이나 장기 저장에 사용하지 않는다.
- Spring Security의 OAuth state, Google OIDC nonce·서명 검증 경로를 사용한다. Frontend가 보낸 공급자 ID·권한·memberId를 신원 증명으로 신뢰하지 않는다.
- 로그인 증명은 짧게 만료하고 가입/로그인 완료에서 소비한다. 증명 소비를 세션 내에서 직렬화한다.
- 닉네임 검증과 DB 고유 제약을 함께 사용한다. 사전 중복 확인만 믿고 가입을 완료하지 않는다.
- 회원 생성·정책 동의·회원 계정 생성 outbox·Refresh 저장을 업무 트랜잭션으로 묶는다. 실패 시 고아 회원이나 일부 동의만 남지 않도록 테스트했다.
- 재가입은 새 memberId다. 과거 금융 이력을 자동 복원/병합하지 않는다.

보강점:

1. 서버 정책 문서가 `DEVELOPMENT_DRAFT`다. 초안과 실제 동의 원문을 구분하는 현재 표현은 정직하지만 정식 서비스의 최종 가입 내용이 완성된 상태는 아니다. 이 보고서는 법률 문서 적합성을 판단하지 않는다.
2. 가입·닉네임 확인·Guest 생성 등에 대한 애플리케이션 수준의 남용 제한을 관련 코드에서 확인하지 못했다. 모의자금 생성이나 공개 닉네임 조회도 무제한 반복을 가정하면 운영 품질을 떨어뜨릴 수 있다. 외부 방어 장치가 있다는 가정은 이번 평가에서 하지 않았다.
3. 가입은 보존되었는데 응답을 잃은 상황의 브라우저 복구를 실제 공급자 로그인과 함께 확인해야 한다. 임의 재가입 반복 대신 현재 로그인 상태 조회로 수렴하는 경험이 필요하다.

근거: [AuthService.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/auth/service/AuthService.java), [OAuthConfiguration.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/auth/oauth/OAuthConfiguration.java), [VerifiedIdentity.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/auth/oauth/VerifiedIdentity.java), [MemberLifecycleIntegrationTests.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/test/java/com/yogimangchi/content/member/MemberLifecycleIntegrationTests.java).

### 3.2 로그인·세션

회원 Access는 RS256 자체 JWT, 15분, JSON 응답과 Frontend 메모리 보관이다. Refresh는 무작위 256비트 토큰, 고정 7일, DB에는 SHA-256 해시만 저장한다. HttpOnly 쿠키이며 운영 Secure를 사용한다. Refresh 사용 시 회전하고, 이미 사용한 토큰의 재사용은 해당 계열을 폐기한다. 회전해도 최초 7일 만료를 연장하지 않는다.

특히 다음 처리가 좋다.

- Refresh와 탈퇴가 `Member → Refresh` 순서로 잠근다. 탈퇴 뒤 토큰이 다시 발급되는 경합을 방어한다.
- 재사용 탐지 시 401을 반환해도 폐기 변경은 commit하도록 설정한다.
- CSRF가 필요한 쿠키 요청을 검증한다. 탈퇴의 Bearer+OAuth 세션 조합에서도 CSRF가 생략되지 않게 별도 필터를 둔다.
- 로그인/토큰을 URL로 운반하지 않는다. CORS origin을 명시한다.
- Frontend는 Web Locks로 여러 탭의 쿠키 변경을 직렬화한다. BroadcastChannel로 로그인/종료 변화를 알리고 이전 사용자 요청·캐시 세대를 폐기한다.
- Trading은 JWT를 직접 검증하며 Content 회원 테이블을 조회하지 않는다. 자기 계정으로 주문 범위를 제한한다.

보강점:

- 회전 응답이 유실되면 브라우저에는 이미 소비된 Refresh가 남을 수 있다. 다시 사용하면 도난과 구분할 수 없어 계열이 폐기된다. 현재 보안상 일관된 선택이지만 사용자에게 “세션 복구 실패, 소셜 재로그인 필요”를 명확히 안내해야 한다. 임의 자동 재시도나 무조건적인 유예시간 도입은 권장하지 않는다.
- `navigator.locks`가 없으면 쿠키 작업을 거부한다. 안전한 방식이지만 지원 브라우저 계약·안내를 확인해야 한다.
- Refresh와 임시 세션 쿠키의 SameSite는 Lax다. Frontend와 Content가 **다른 site**라면 cross-site fetch에 쿠키가 실리지 않을 수 있다. 다른 origin과 다른 site는 다르다. `app.example.com`/`api.example.com` 구성과 무관한 두 도메인 구성의 차이를 실제 브라우저에서 확인해야 한다. CORS 허용만으로 해결되지 않는다. 이것은 서버 증설 문제가 아니라 로그인 쿠키 계약 검증이다.
- 로그아웃은 Refresh 계열 폐기이며 이미 발급한 Access의 즉시 폐기는 약속하지 않는다. 최대 15분 잔존은 승인된 계약이므로 그 자체를 버그로 감점하지 않았다.
- Guest는 현재 7일 opaque Bearer다. 회원 JWT와 호환·소유권 처리는 있지만 “세 로그인 방식 모두 자체 JWT”라는 최종 상태에는 아직 도달하지 않았다. 실자금이 없는 현재 단계에서 이 전환을 청산 정합성보다 먼저 할 필요는 없다.

근거: [AuthService.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/auth/service/AuthService.java), [AuthController.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/auth/controller/AuthController.java), [session.ts](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/member/api/session.ts), [RefreshConcurrencyIntegrationTests.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/test/java/com/yogimangchi/content/auth/RefreshConcurrencyIntegrationTests.java).

### 3.3 탈퇴

현재 흐름:

1. 동일 회원의 최근 소셜 로그인 증명, 안내 확인, 정확한 `탈퇴합니다`, 정책 버전, CSRF를 검증한다.
2. Content 회원을 WITHDRAWING으로 전환하고 모든 Refresh를 폐기한다. 계정 생성 전달 요청을 취소하고 탈퇴 전달 요청을 저장한다.
3. Frontend는 금융 연결을 중단하고 완료와 접수를 구분한다.
4. 별도 worker가 목적 제한 내부 JWT로 Trading에 전달한다. HTTP는 Content 업무 트랜잭션 밖에서 호출한다.
5. Trading은 계정 생성과 공유하는 advisory lock 및 계정 row lock으로 미체결 취소·예약 해제·포지션 관리 종료·회차 종료·WITHDRAWN을 원자적으로 처리한다.
6. Trading의 204 확인 뒤 Content가 OAuth 연결·Refresh·동의 이력을 파기하고 프로필을 비우며 COMPLETED로 전환한다.

Trading의 탈퇴 처리는 **시장가 청산 체결을 만들지 않는 관리상 종료**다. 가상자금 서비스에서는 합리적이다. 없는 체결가·손익·수수료를 조작하지 않고 기존 실제 체결 이력은 유지한다. 현재 회차 이력은 관리 종료 이유와 종료 전 노출 정보를 별도로 보존한다. 사용자 안내도 “모든 포지션이 시장가 매도됐다”라고 표현하면 안 된다.

중요한 한계 A — 전파 전 거래 창:

- Content는 WITHDRAWING을 즉시 확인하지만 Trading의 회원 인증은 Trading 계정의 WITHDRAWN 여부만 확인한다.
- 따라서 Content가 탈퇴를 접수한 뒤 Trading 차단이 commit되기 전까지, 이미 가진 유효 Access JWT를 직접 사용한 거래가 허용될 수 있다.
- 기본 전달 주기는 5초이나 실제 창이 항상 5초 이하라는 뜻은 아니다. 전달 실패 시 재시도 대기 최대 300초이고 반복 실패하면 차단 확인이 지연된다. 기존 토큰은 남은 Access 수명 동안 사용할 수 있다.
- 정리가 완료된 후의 재거래와는 구분한다. 완료 후에는 Trading 계정 상태와 잠금 경로로 차단한다. 현재 outbox가 유실된다는 주장도 아니다.

권장: “요청 전달 중”과 “Trading 차단 확인”을 명시적으로 나누고, 금융 차단 완료 시점을 제품 계약으로 정한다. 접수 완료부터 거래 불가가 필요하다면 Trading의 WITHDRAWING/동결 ACK 경로와 이후 멱등 정리를 설계한다. 서비스 간 HTTP를 Content DB 트랜잭션 안에 넣어 원자성이 생긴다고 가정해서는 안 된다. 매 주문 Content 동기 조회도 현재 경계에 맞지 않는다.

중요한 한계 B — 장기 PENDING 복구:

- Frontend의 진행 조회 인증은 메모리에 보관한 마지막 Access에 의존한다. 만료·탭 종료 뒤 상세 진행을 이어 보는 전용 계약이 없다.
- OAuth 재접속 시 WITHDRAWAL_PENDING 안내는 가능하지만 상세 상태를 계속 조회하는 인증/UX는 미완이다.
- 서버에는 재시도 횟수와 다음 시각이 있으나 사용자에게 지연 이유·차단 확인·다음 확인 방법을 충분히 전달하지 못한다.

권장: 최근 같은 공급자 신원 확인으로 탈퇴 상태만 조회하는 짧은 목적 제한 증명을 발급한다. 그 증명으로 일반 회원 API나 Trading을 재활성화하지 않는다. 전달 실패의 안전한 이유 분류와 운영자 재시도/검토 경로도 마련한다.

추가 확인: 현재 재동의 미완료 시 금융 연결을 막는 것은 Frontend의 게이트다. Trading JWT에는 현재 동의 버전이 없고 관련 서버 검증을 찾지 못했다. “동의 전 거래 불가”를 실제 접근 정책으로 사용할 경우 직접 API 호출도 막는 목적 제한된 서버 계약이 필요하다. UX 차단만을 요구한 것이라면 정책을 그렇게 명시해야 한다.

근거: [MemberWithdrawals.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/member/service/MemberWithdrawals.java), [WithdrawalDelivery.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/content-server/src/main/java/com/yogimangchi/content/member/service/WithdrawalDelivery.java), [MemberWithdrawal.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/service/MemberWithdrawal.java), [MemberCredentials.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/security/MemberCredentials.java), [member-withdrawal.tsx](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/member/components/member-withdrawal.tsx).

## 4. 시장가 진입 → 손익 → 종료

### 4.1 체결과 알림

현재 서버 처리 순서는 계정 잠금 → 요청/소유권/계정 상태 → 서버의 최신 Mark와 엔진 추적 상태 → 담보+수수료+격리 위험 → 주문·체결·포지션·지갑·이벤트 commit → 응답 → Frontend 알림이다.

성공 토스트가 실제 체결보다 먼저 뜨는 구조가 아니다. 현재 시장가 성공은 저장된 FILLED 응답을 받은 뒤 알려준다. 이는 올바른 순서다. 지정가의 “접수 성공”과 “체결 성공”도 구분한다.

- 체결 기준은 Binance USDⓈ-M **Mark Price**다. Last Price나 주문창 표시 가격과 같다고 보장하지 않는다.
- 오래된 가격, 최신 가격을 처리하지 못한 엔진, 비활성 계정, 부족 자금은 거부한다.
- 같은 계정·종목·방향의 추가 진입은 같은 Position으로 합쳐 수량·원가·평균 단가를 갱신한다. 반대 방향은 독립 Position이다.
- Order와 Fill은 별도 이력이다. Position만 생성하고 거래 흔적을 생략하지 않는다.
- 동일 Idempotency-Key+동일 내용은 결과를 재사용하고, 같은 키+다른 내용은 거부한다.
- Frontend는 더블클릭을 합치고 자동 mutation 재시도를 하지 않는다. 결과 불명확 시 동일 키·동일 요청으로만 확인한다.

모의투자에서 Mark 전량 체결, 호가 잔량 미소비, 부분체결/슬리피지 부재는 승인된 단순화다. 이들을 실거래소와 다르다는 이유만으로 핵심 결함으로 평가하지 않았다. 다만 사용자에게 “실제 시장가 체결 재현”이라고 설명하면 안 된다.

### 4.2 실시간 손익·청산가

- 보유 종목의 WS Mark를 받아 Frontend가 BigInt로 표시용 PnL/ROE를 갱신한다. 지갑·수량·증거금·실현손익 원본은 서버 응답이다.
- REST Summary는 기본 5초 주기이고, 체결 이벤트가 오면 추가 갱신한다. 모든 자산 숫자가 매 tick마다 서버와 동시에 바뀌는 구조는 아니다.
- 표시 PnL은 대략 `방향부호 × 수량 × (Mark − 평균진입가)`, ROE는 `미실현 PnL / 현재 포지션 증거금 × 100`이다. 거래 수수료까지 뺀 최종 수익률과 다르다.
- 서버의 실제 정산은 반올림된 표시 평균가가 아니라 보존한 원가(entryNotional)를 사용한다. Frontend 참고값과 극소수점 차이가 날 수 있으며 정산 원본을 덮어쓰지 않는다.
- 청산가는 서버의 격리 위험 계산에서 산정하고 산정 상태·시각을 함께 제공한다. 가격이 없으면 임의 숫자를 만들지 않는다. 반올림 경계와 탐색 예산도 처리한다.
- 청산가 숫자는 미래 실제 체결가 보장이 아니다. Mark gap이 있으면 넘어선 Mark로 체결한다.

### 4.3 부분/전체 청산

청산은 보유 포지션 ID와 서버 상태를 기준으로 한다. 지정가 CLOSE는 지갑 증거금 대신 수량을 예약한다. 시장가 부분 종료는 미예약 수량까지만 가능하며, 다른 지정가 종료의 예약을 침범하지 않는다. 전체 종료에 예약 수량이 있으면 먼저 취소해야 한다.

부분 종료는 원가·증거금을 비례 해제하고 마지막 종료에서 남은 반올림 잔여를 모두 해제한다. 신규 진입 최소 10 USDT 제한과 작은 잔여 포지션의 종료를 구분한다. 전체 청산 요청 후 추가 진입이 먼저 commit되는 등의 경우에는 잠금을 획득한 시점의 상태가 기준이라는 점도 계약상 명확해야 한다.

근거: [TradingOrderService.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/execution/TradingOrderService.java), [Position.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/position/entity/Position.java), [position-display.ts](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/trading/api/position-display.ts), [LiquidationPriceEstimator.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/service/LiquidationPriceEstimator.java).

## 5. 지정가 엔진: 조건·조회 효율·복구

### 5.1 먼저 요청 문장의 조건을 바로잡아야 한다

요청의 “롱에서 현재가가 요청가보다 높으면 거부, 숏에서 현재가가 요청가보다 낮으면 거부”는 일반적인 대기 지정가 진입 방향과 반대다.

현재 서비스는 즉시 체결 가능한 지정가를 받지 않는 **passive-only** 정책이다.

| 동작 | 접수 조건 | 이후 체결 조건 |
|---|---|---|
| LONG 진입 = BUY | 지정가 < 현재 Mark | Mark ≤ 지정가 |
| SHORT 진입 = SELL | 지정가 > 현재 Mark | Mark ≥ 지정가 |
| LONG 종료 = SELL | 지정가 > 현재 Mark | Mark ≥ 지정가 |
| SHORT 종료 = BUY | 지정가 < 현재 Mark | Mark ≤ 지정가 |

접수 시 현재가와 같은 지정가도 거부한다. 현재가 100, LONG 지정가 99는 정상 접수하고, LONG 지정가 101은 거부한다. SHORT 지정가 101은 접수하고 99는 거부한다.

따라서 현재 구현을 요청 문장대로 단순 반전하는 것은 권장하지 않는다. 일반 지정가처럼 즉시 체결 가능한 가격도 지원하려면 별도의 marketable limit 정책을 정의해야 한다. 현 서비스의 passive-only는 모의투자에서 가능한 제품 선택이며 UI에 설명해야 한다.

또한 **지정가와 정확히 같은 값으로 체결하지 않는다.** LONG 지정가 99에서 Mark가 100→98로 이동하면 98에 체결한다. SHORT 101에서 100→102면 102에 체결한다. 이는 지정가보다 유리한 통과 Mark 체결 정책이다. 기존 자동 테스트가 바로 이 가격을 검증한다. “정확히 주문가격”이 꼭 필요하면 체결가·수수료·예약·gap 정책을 함께 바꾸어야 한다.

### 5.2 어떤 기술로 DB를 조회하는가

실제 구현은 **Redis Streams + Lua, PostgreSQL checkpoint, Spring JDBC 후보 조회, JPA 금융 변경**이다. Redis Sorted Set 매칭, Kafka, QueryDSL, 모든 주문의 메모리 가격 트리를 사용한다고 설명하면 사실과 다르다.

1. 가격 수신을 최신값만으로 축약하지 않고 Redis Stream에도 기록한다. Lua에서 역순 방지·신선도 검증·snapshot·Stream·Pub/Sub 갱신을 처리한다.
2. 단일 worker가 50ms fixed delay로 읽는다. 한 번의 Stream 조회는 최대 64개이며, 실행시간을 제외한 지연 설정이지 50ms 체결 보장은 아니다.
3. `TriggerCandidates`가 해당 종목의 OPEN 포지션 보유 계정과 가격 조건을 만족한 PENDING 주문 계정만 구한다.
4. SQL은 LONG/SHORT·OPEN/CLOSE의 가격 범위 조건을 사용한다. 계정 ID 기반 keyset pagination으로 100개씩 처리한다.
5. PENDING 주문의 `(symbol, side, limit_price, account_id)` 부분 인덱스와 OPEN 포지션의 `(symbol, account_id)` 부분 인덱스가 있다. 계정별 pending 조회 인덱스도 있다.
6. 후보 계정의 DB 잠금을 얻은 뒤 그 계정의 OPEN 포지션/PENDING 주문을 읽고 체결을 다시 판단한다. 후보 조회 결과만으로 체결하지 않는다.
7. 해당 tick의 계정별 금융 처리 commit 후 PostgreSQL cursor를 갱신한다. cursor 저장 전 장애는 같은 tick을 재실행하며 상태 전이로 중복을 방지한다.

**평가:** 전체 DB 주문을 매 tick 읽는 방식보다 합리적이고 복구 가능한 구조다. 그러나 해당 종목의 OPEN 포지션을 가진 계정은 모든 tick의 후보가 된다. 후보마다 다른 종목을 포함한 계정의 OPEN/PENDING을 읽는다. 계정당 포지션/미체결 상한은 각각 100개지만 전체 활성 계정 수의 비용은 계속 증가한다. 인덱스가 있다는 이유로 상수 시간 처리나 대규모 처리 성능을 보장하지 않는다. 실행계획과 실측 부하 검증이 필요하다.

### 5.3 가격 통과를 어디까지 보존하는가

| 상황 | 현재 처리 | 보장 범위 |
|---|---|---|
| 100→98이 되어 99를 정확히 찍지 않음 | `≤/≥` 조건 | 감지 가능 |
| 100→98→102, 모두 Stream에 남고 fresh | tick을 순서대로 처리 | 98에서 LONG 주문 체결 가능 |
| 계정 commit 뒤 cursor 저장 전에 장애 | 같은 이벤트 재처리 | 중복 체결 방어 |
| Stream trim/유실 | gap 감지, cursor/book 재구성, fresh 가격으로 현재 노출 점검 | 현재도 조건을 충족하면 복구 가능 |
| Redis 게시 실패/큐 유실 | 가용성 저하와 continuity gap 기록, 신규 거래 제한 | 사라진 가격 통과를 복원하지 못함 |
| Stream에는 있지만 처리 시 가격이 5초 이상 경과 | 오래된 tick을 실행하지 않고 진행 | 과거 일시 crossing을 놓칠 수 있음 |

핵심 제한은 마지막 세 항목이다. 예를 들어 LONG 지정가 99가 있고 수신 가격이 100→98→102였는데 98이 유실되거나 처리 시 만료되었다면, fresh 102만으로 99 통과 사실을 알 수 없다. 청산가 아래로 잠깐 내려갔다 돌아온 경우도 같은 한계다. 이것은 “가격이 다시 조건에 들어오면 처리한다”로 해결되지 않는다.

worker 입구에서 fresh였더라도 계정 처리에 시간이 걸리면 뒤쪽 계정에서는 5초 freshness를 잃을 수 있다. 재처리 상태가 별도로 보존되지 않으면 같은 tick에 대한 계정별 적용 차이로 이어질 수 있다. 이 지연 상황은 새 부하 실험으로 재현하지 않았으며 코드의 시간 검사와 계정 순차 처리에서 도출한 위험이다.

### 5.4 권장 보강

- **시세 유효성**과 **이미 유효하게 수신한 이벤트의 재처리 가능성**을 구분한다. 오래된 시세로 지금 시장가 주문을 허용하는 것과, 당시 접수된 위험 이벤트를 늦게 복구하는 것은 다른 계약이다.
- 수신된 crossing까지 보장하려면 노출 변경 순서와 연결된 재처리 가능한 위험 이벤트 기록을 보존한다. PostgreSQL의 제한된 이벤트 저널/위험 작업 기록 등 현재 규모에 맞는 방식을 검토할 수 있다. 모든 tick을 영구 저장하거나 Kafka를 도입해야 한다는 뜻은 아니다.
- 실제 공급자 단절로 **수신하지 못한** 구간은 어떤 내부 큐로도 완전히 복원할 수 없다. 그 경우는 추정 체결이 아니라 gap 정책 문제다. 재개 시점 처리, 영향 계정 보류, 복구 판단과 기록을 명시한다.
- gap을 단순 로그·누적 횟수로만 남기고 정상 READY와 동일하게 취급하지 말고, 영향 기간/종목/노출과 해결 상태를 영속화한다. 미해결 상태는 사용자에게 구분해 알린다.
- 봉의 고가/저가만으로 주문·레버리지 변경 전후 순서까지 완벽히 복원할 수 있다고 가정하지 않는다. 범위를 보존하더라도 노출의 유효 구간·처리 순서를 함께 설계해야 한다.
- 한 계정의 반복 처리 실패가 전체 cursor를 정지시키는 경로를 마련한다. 제한된 재시도 이후 실패 계정/이벤트를 보류·검토 대상으로 영속화하되, 해당 계정의 위험 이벤트 순서를 깨거나 조용히 skip해서는 안 된다.

현재 worker의 예외는 전체 RECOVERING과 최대 30초 backoff로 이어진다. 이는 안전하게 거래를 멈추는 장점이 있지만 한 계정의 데이터 문제로 다른 계정까지 계속 중단될 수 있다. 인프라 문제가 아니라 엔진 작업 격리·복구 정책이다.

근거: [TriggerCandidates.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/execution/trigger/TriggerCandidates.java), [MarketTriggerWorker.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/execution/trigger/MarketTriggerWorker.java), [RedisMarketDataBridge.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/marketdata/RedisMarketDataBridge.java), [TriggerIntegrationTests.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/test/java/com/yogimangchi/trading/execution/trigger/TriggerIntegrationTests.java).

## 6. 수수료·추가 체결·강제청산의 동시성

### 6.1 현재 방어 구조

핵심 금융 경계는 JVM 락이 아니라 **PostgreSQL 계정 row의 PESSIMISTIC_WRITE 잠금**이다. 계정별 주문·취소·체결·청산·레버리지 변경을 직렬화한다. lock timeout은 2초이며 API 경합은 TRADING_BUSY로 처리한다. 별도의 JVM read/write gate는 tick과 사용자 트랜잭션의 순서를 맞추며 commit까지 유지한다. 이 gate를 분산 금융 잠금이라고 설명해서는 안 된다.

같은 계정의 여러 종목은 하나의 USDT 지갑을 공유하므로 계정 단위 잠금은 합리적이다. 지갑만 조회하는 경로도 같은 잠금을 사용하여 서로 다른 commit의 지갑/포지션이 섞이지 않게 한다. 반대로 잦은 조회가 거래와 경합할 수 있으므로 부하 측정은 필요하다.

수수료는 주문 유형별 고정 모의정책이다.

| 상황 | 비율 | 반영 |
|---|---:|---|
| MARKET 진입/종료 | 0.05% | 실제 체결 Mark × 수량, 소수 18자리 올림 |
| LIMIT 진입/종료 | 0.03% | 실제 체결 Mark × 수량, 소수 18자리 올림 |
| 강제청산 | 0.05% | 청산 Mark 기준 비용 |

Maker/Taker 실체결이나 특정 거래소 요율을 그대로 재현한 것은 아니다. 신규 LIMIT OPEN은 지정가 기준 증거금+수수료를 예약하되 접수 시 실제 수수료를 차감하지 않는다. 취소는 예약만 해제한다. 체결 시 예약을 해제하고 **최종 체결가의 추가 증거금+수수료를 다시 검증**한다. 부족하면 주문 REJECTED와 사유를 남긴다.

특히 SHORT는 유리하게 높은 가격에 체결되어도 명목가치가 커져 증거금·수수료가 증가할 수 있다. 접수 당시 예약액만 믿으면 안 되며 현재 코드는 이를 재검증한다. 추가 진입은 기존 정확한 원가와 증거금을 합산해 증가분을 계산한다.

### 6.2 주요 경합별 판정

| 동시 상황 | 현재 처리 |
|---|---|
| 여러 시장가/지정가가 같은 지갑 사용 | 계정 잠금 후 최신 사용/예약액으로 계산 |
| 같은 방향 추가 진입 | 하나의 통합 Position, DB의 OPEN 고유성 제약 |
| 주문 취소 vs 지정가 체결 | 잠금 뒤 PENDING 상태 재검증, 한쪽만 유효 |
| 부분 종료 vs 다른 지정가 종료 | 수량 예약과 미예약 수량 검사로 초과 종료 방어 |
| 레버리지 변경 vs 체결 | 같은 잠금, 설정·기존 담보·PENDING 예약을 원자적으로 갱신 |
| 사용자 종료 vs 강제청산 | 최신 잠긴 포지션 상태 기준, 중복 수량 정산 방어 |
| Fill 저장 실패 | Order/Position/Wallet/예약/이벤트 함께 rollback |
| 이벤트 재전송 | 주문 상태·고유 키로 중복 금융 반영 방어 |

위 경합은 단순 기대가 아니라 기존 테스트에 구체적인 시나리오가 있다. 다만 작은 동시 실행 테스트 통과는 수천 계정의 지연·공정성을 증명하지 않는다.

### 6.3 강제청산 정산

현재 정책은 Hedge+Isolated-only다. 각 포지션의 `담보 + 미실현손익`이 `유지증거금 + 청산수수료 reserve` 이하이면 위험 상태다. 유지증거금률은 고정 0.5%다. 다른 포지션의 수익·미사용 지갑 자금으로 자동 보전하지 않는다.

가격 gap으로 실제 손실과 수수료가 해당 담보를 초과하면 그 초과분을 `settlementAdjustment`로 분리해 기록한다. 실제 Gross PnL을 가짜로 줄이거나 다른 포지션 담보를 소모시키지 않는다. 지갑은 `Gross PnL − Fee + Adjustment`로 반영한다.

강제청산 시 해당 포지션의 PENDING CLOSE는 정리하지만 독립적인 PENDING OPEN까지 모두 취소하지 않는다. 따라서 같은 tick에서 기존 포지션이 청산되고, 남아 있던 진입 지정가가 새 포지션 생애주기를 시작할 수 있다. 테스트가 의도적으로 허용한다. 이것은 중복 체결 버그가 아니다. 다만 사용자 기대와 다를 수 있으므로 **청산 후에도 진입 주문 유지**를 안내하거나 제품 정책으로 선택하게 해야 한다.

보강 우선순위는 이미 구현된 잠금을 다시 만드는 것이 아니다. 다음 항목이 더 중요하다.

- 지갑 사용 증거금 = OPEN 담보 합, 예약 증거금 = PENDING OPEN 예약 합, 종료 예약 수량 = PENDING CLOSE 수량 합을 운영 중 읽기 전용으로 대사한다.
- 수수료·Gross PnL·조정액을 Fill 합계와 대사하고, Guest 재도전/회원 회차 초기화의 별도 자본조정을 포함한다. 단순 `잔액=10000+평생PnL`은 초기화 후 틀리다.
- 대사 불일치를 발견해 자동으로 잔액을 덮어쓰지 말고 해당 계정을 보류하고 재현 가능한 원인을 남긴다.
- 주문 폭주·다중 탭·긴 조회에 따른 계정별 지연과 실패 비율을 측정한다. 가격/작업 유효기간과 연계해 테스트해야 한다.

근거: [AccountLock.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/service/AccountLock.java), [Wallet.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/entity/Wallet.java), [TradingFees.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/execution/TradingFees.java), [AccountTriggerService.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/execution/trigger/AccountTriggerService.java), [FuturesFeeIntegrationTests.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/test/java/com/yogimangchi/trading/execution/FuturesFeeIntegrationTests.java), [HedgeTradingIntegrationTests.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/test/java/com/yogimangchi/trading/execution/HedgeTradingIntegrationTests.java).

## 7. 레버리지: 현재 동작과 필요한 변경

### 7.1 현재는 양방향 공유다

Backend 설정의 식별자는 `(accountId, tradingSymbolId)`이고 side가 없다. 변경하면 해당 종목의 LONG/SHORT 포지션 모두의 담보와 PENDING OPEN의 예약액을 갱신한다. Frontend도 현재 “공통 레버리지 · Isolated” 하나를 표시한다. Summary 파서는 같은 종목의 양쪽 레버리지가 다르면 계약 오류로 거부한다.

즉 “프론트는 이미 독립인데 백엔드만 고치면 된다”도 현재 코드와 다르다. 과거 README의 독립 표시 설명은 낡았다. **프론트·백엔드·DB·DTO·quote·검증·테스트를 함께 바꿔야 한다.**

현재 1~100배 지원은 구현되어 있다. 20배가 현재 상한이라고 판단하면 안 된다.

### 7.2 다른 종목과 수익률에 미치는 영향

현재 격리 모델에서 BTC 레버리지를 변경하면:

- BTC의 LONG과 SHORT 담보/예상 청산가/ROE 분모가 함께 바뀐다.
- BTC의 미체결 OPEN 예약도 바뀌며 원래 요청 배수는 별도 보존한다.
- ETH 등 다른 종목의 기존 담보·청산가·절대 PnL은 직접 바뀌지 않는다.
- 같은 USDT 지갑의 가용자금은 달라져 다른 종목의 **향후 신규 주문 여력**에는 영향을 준다.
- 포지션 수량과 진입가가 같으면 레버리지만 바꿔 절대 손익이 달라지지 않는다. ROE는 증거금이 바뀌어서 달라진다.

예: 진입가 100, 수량 10 LONG, Mark 102면 미실현 이익은 20 USDT다. 10배 담보 100이면 ROE 20%, 20배 담보 50이면 ROE 40%다. 이미 보유한 수량의 이익이 40 USDT로 늘어나는 것은 아니다. 수수료 전 표시 예시다.

현재 고정 유지증거금률 0.005, 종료 비용률 0.0005에서 반올림을 무시한 근사 청산가는 다음과 같다. `E=원가`, `M=담보`, `Q=수량`, `c=0.0055`다.

- LONG: `(E − M) / (Q × (1 − c))`
- SHORT: `(E + M) / (Q × (1 + c))`

진입 100의 LONG을 10배에서 20배로 바꾸면 근사 청산가는 약 90.4977→95.5254가 되어 현재 가격에 가까워진다. SHORT는 약 109.3983→104.4257로 가까워진다. 실제 서버 산정값은 반올림 경계를 검사하므로 표시 예시와 마지막 자리 차이가 있을 수 있다. 레버리지 인하 시 자금이 부족하거나 변경 후 즉시 위험해지면 변경 전체를 거부한다.

### 7.3 Binance·Bybit 공식 기준과 비교

Binance USDⓈ-M의 레버리지 변경 API는 symbol과 leverage를 받으며 side별 배수 필드는 없다. Binance의 공식 설명도 Hedge에서 같은 종목의 initial leverage 공유를 설명한다. 반면 Bybit V5는 `buyLeverage`와 `sellLeverage`를 구분하고, Hedge+Isolated에서 서로 다르게 허용하며 Cross에서는 같아야 한다. 이번 요구는 **Bybit의 Hedge+Isolated 방향별 설정**에 가깝다. 두 거래소의 모든 상품이 동일하다고 일반화하지 않는다. [Binance USDⓈ-M API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade), [Binance 레버리지 설명](https://www.binance.com/en/academy/articles/how-to-change-an-open-position-s-leverage-via-api), [Bybit Set Leverage](https://bybit-exchange.github.io/docs/v5/position/leverage).

Bybit 격리 청산은 포지션별 담보와 Mark를 사용하며 다른 포지션에 직접 영향을 주지 않는다고 설명한다. 다만 실제 거래소의 위험 구간별 MMR·단계적 청산과 현재 서비스의 고정 MMR·남은 포지션 전량 청산은 다르다. 거래소 공식 수식을 일부만 복사해 현재 엔진에 섞기보다 **현재 모의정책을 일관되게 유지**하는 것이 우선이다. [Bybit 격리 청산 규칙](https://www.bybit.com/en/help-center/article/UTA-Trading-Rules-Liquidation-Process).

### 7.4 방향별 독립 설정의 변경 범위

1. DB 설정 키를 `(account, symbol, side)`로 확장한다. 기존 공통값을 양쪽 값으로 복제하는 새 migration을 만들고 과거 요청/체결을 덮어쓰지 않는다.
2. GET/PUT 및 응답 DTO에 방향별 설정을 명시한다. side 누락 시 임의 방향에 적용하지 않는다.
3. 주문·quote·비율 수량 계산·trigger가 해당 방향의 설정을 사용한다.
4. LONG 변경은 LONG 포지션과 LONG의 PENDING OPEN만 갱신한다. 반대 방향의 담보/청산가/예약을 바꾸지 않는다. CLOSE 예약 수량을 유지한다.
5. Frontend에 양방향 선택을 제공하고 캐시 키/상태/오류/버튼 표시를 side로 분리한다. 같은 종목의 서로 다른 배수를 거부하는 Summary 검증도 변경한다.
6. LONG 변경 vs SHORT 체결, 양쪽 동시 변경, 레버리지 인하 자금 부족, 청산 경합, 중복 요청을 테스트한다.

현재 Trading AGENTS의 “종목별 LONG/SHORT 설정 레버리지는 공유” 조항과 이번 사용자 요청이 충돌한다. 이번 검토는 이를 변경하지 않았다. 구현할 때는 이번 사용자 요구를 새 제품 계약으로 반영하고 규칙·README·OpenAPI도 동시에 맞춰야 한다.

## 8. 자산 탭 포트폴리오의 실제 의미

현재 Doughnut은 **현재 OPEN 포지션의 종목별 사용 증거금 비중**이다. 같은 종목의 LONG/SHORT 증거금을 더한다. 과거에 거래한 종목 전체의 거래 비율이나 종목별 수익률을 계산하지 않는다. 미사용 현금·미체결 예약도 이 차트의 분모에 포함되지 않는다.

예: BTC LONG 담보 100 + SHORT 300, ETH 담보 600이면 BTC 40%, ETH 60%다. BTC 거래 수량·누적 거래대금·누적 수익 기여도가 40%라는 뜻은 아니다. 레버리지를 높여 담보가 줄어들면 수량은 그대로여도 비중이 줄 수 있다. 또한 같은 종목 양방향을 합친 값은 순방향 노출을 보여주지 않는다.

이 데이터는 현재 자금 배치를 이해하는 데 의미가 있다. 다만 “포트폴리오 성과”를 기대한 사용자에게는 불충분하다. 차트에 현재처럼 기준을 명시하고 자금 구성과 거래 성과를 나누는 것을 권장한다.

### 권장 표시

| 표시 | 집계 기준 | 사용자 의미 |
|---|---|---|
| 가용/사용/예약 자금 | 현재 Wallet | 지금 사용할 수 있는 돈과 묶인 돈 |
| 현재 종목별 담보 비중 | OPEN 담보 합 / 전체 OPEN 담보 | 자금 배치 |
| 현재 종목별 명목노출 | LONG·SHORT 명목가치와 순노출 분리 | 레버리지 때문에 차트에서 숨을 수 있는 노출 |
| 기간·회차별 거래비중 | 실제 Fill 거래대금 / 전체 실제 Fill 거래대금 | 무엇을 많이 거래했는가 |
| 종목별 순실현손익 | 실제 실현손익 − 관련 수수료 | 어떤 종목에서 얼마를 벌고 잃었는가 |
| 전체 회차 수익률 | 현금흐름/회차 초기자금 기준 순자산 변화 | 이 모의투자에서의 총 성과 |

거래비중의 거래대금은 `체결가 × 체결수량`으로 계산한다. 진입+종료를 모두 포함할지 진입만 포함할지 라벨로 고정한다. 거절/취소/미체결, 재도전 자금, 관리상 종료를 실제 거래량으로 세지 않는다. 강제청산은 거래대금에 포함 여부를 명시하고 별도 분류한다.

성과에는 다음 원칙이 필요하다.

- 기간과 회차를 반드시 명시한다. 회원 재시작/Guest 초기화 전후를 같은 최초 10000 분모로 섞지 않는다.
- 포지션별 ROE의 단순 평균을 종목 수익률로 사용하지 않는다. 수량·시간·담보·레버리지 변경을 무시하기 때문이다.
- `순실현손익 / 누적 진입담보`를 쓴다면 “누적 투입담보 대비 수익률”로 정의한다. 이를 일반적인 기간 투자수익률과 같다고 표현하지 않는다.
- 전체 계정 성과는 명확한 회차 초기자금과 자본조정을 반영한 순자산 기준을 먼저 제공하는 편이 신뢰성이 높다.
- 순경제손익과 사용자 잔액 성과를 분리한다. `settlementAdjustment`는 거래로 번 수익이 아니다. 조정 포함 Net cash 결과만 보여주면 청산 초과손실 보전이 투자 실력처럼 보일 수 있다.
- 현재 미실현손익은 진행 중 성과로 별도 표시하고, 확정 실현손익과 합칠 경우 평가 시점을 표시한다.

현재 실제 Fill 이력과 종료 포지션의 Gross/Fee/Adjustment/Net 조회 API는 이미 있다. 이를 재사용하면 된다. 다만 서버에 종목별 성과 집계 계약이 없는 상태에서 Frontend 최신 50건만 합산해 “전체 성과”라고 표시하면 안 된다. 필요한 기간·회차 집계를 Backend에서 제공하고 페이지 일부 집계와 전체 집계를 구분한다.

근거: [allocation.ts](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/trading/portfolio/allocation.ts), [portfolio-allocation-chart.tsx](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/trading/components/portfolio-allocation-chart.tsx), [TradeHistoryService.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradehistory/service/TradeHistoryService.java), [MemberRounds.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradinground/MemberRounds.java).

## 9. 체결 알림과 신뢰할 수 있는 오류 전달

### 9.1 이미 구현된 알림

Order 상태 변화와 이벤트 snapshot은 금융 트랜잭션 안에서 PostgreSQL에 함께 저장한다. 개인 WS는 토큰을 URL에 넣지 않고 연결 후 인증하고, 이벤트 ID cursor로 재개한다. 첫 REST 조회는 과거 이력을 알림 없이 baseline으로 동기화하고, 이후 LIMIT 체결/거절·강제청산을 알린다. 중복/역순 이벤트와 계정 전환을 방어한다.

기본 전송은 at-least-once이며 Frontend가 cursor로 중복을 걸러낸다. 서버는 250ms sweep과 dirty signal, 주기 polling을 함께 사용한다. “commit 순간에 반드시 0ms로 토스트”를 보장하는 구조는 아니다. 그래도 단순 REST 이력 polling만 있는 상태보다 발전되어 있다. 개인 체결 WS가 없다는 과거 README의 설명은 현재와 다르다.

첫 baseline에서 오프라인 동안의 이벤트를 토스트로 다시 울리지 않는 것은 가능한 선택이다. 하지만 놓친 중요 알림을 모아서 볼 수 있는 사용자 경험은 별도 개선 여지가 있다.

### 9.2 가장 명확한 오류 UX 결함

Backend는 REJECTED 주문에 `INSUFFICIENT_MARGIN`, `POSITION_LIMIT`, `ACCOUNT_AT_RISK`, `POSITION_LIQUIDATION` 등의 reason을 저장하고 응답한다. Frontend 파서도 reason을 보존한다.

그런데 비동기 지정가 거절 토스트는 “주문 내역을 확인해 주세요”이고, **주문 내역 표에는 reason 열이 없다.** 사용자가 안내대로 이동해도 구체적인 거절 원인을 볼 수 없다. 짧고 신뢰할 수 있는 정보전달 요구에 직접적인 부족이다.

권장: reason 원문을 그대로 렌더링하지 말고 허용목록으로 안전한 짧은 문구에 매핑한다.

| 서버 원인 | 권장 사용자 문구 |
|---|---|
| INSUFFICIENT_MARGIN | 체결 시점의 증거금과 수수료가 부족해 주문이 거절됐습니다. |
| POSITION_LIMIT | 보유 가능한 포지션 수를 초과했습니다. |
| ACCOUNT_AT_RISK | 체결 후 청산 위험이 있어 주문을 거절했습니다. |
| POSITION_LIQUIDATION | 대상 포지션이 강제청산되어 종료 주문이 거절됐습니다. |
| SYMBOL_NOT_ACTIVE | 현재 거래가 중단된 종목입니다. |
| 결과 불명확 | 결과를 확인하지 못했습니다. 같은 요청으로 확인해 주세요. |

사용자 취소(CANCELED)와 시스템 거절(REJECTED)은 표시에서도 구분해야 한다.

현재 좋은 점은 서버의 임의 오류 detail을 사용자에게 그대로 보여주지 않고 알려진 code만 매핑한다는 것이다. 민감정보 노출을 막는 이 원칙은 유지해야 한다. 다만 PENDING_LIMIT_REACHED, POSITION_LIMIT_REACHED 등 일부 코드는 구체적인 사용자 메시지가 부족하다. Content도 MEMBER_BUSY, 정책 오류, 닉네임 중복을 더 잘 구분할 여지가 있다. OAuth 실패는 대부분 oauth_failed로 축약되어 사용자 취소/공급자 장애/이메일 조건을 구별하기 어렵다.

토스트 수명은 1.5초다. 일반 성공 안내에는 가능하지만 강제청산·거절 원인에는 너무 짧을 수 있다. 중요 오류는 사용자가 닫을 때까지 유지하거나 주문 행/알림 내역에서 계속 확인할 수 있어야 한다. 추적용 request/order ID와 안전한 오류 분류를 함께 제공하면 문의·재현도 쉬워진다.

근거: [TradingEvents.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingevent/service/TradingEvents.java), [TradingEventWebSocketHandler.java](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/trading-server/src/main/java/com/yogimangchi/trading/tradingevent/websocket/TradingEventWebSocketHandler.java), [trading-events.ts](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/trading/api/trading-events.ts), [notices.ts](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/trading/api/notices.ts), [account-tables.tsx](C:/Users/wjdwl/Desktop/coding/YogiMangchi_v2/frontend/src/features/trading/components/account-tables.tsx).

## 10. 당장 보강할 순서와 완료 조건

P0는 운영 공개 전에 해소할 조건, P1은 이번 요구 완성과 신뢰도에 직접 필요한 항목, P2는 후속 품질 개선이다. 모두 새 대형 인프라 도입과 무관한 애플리케이션 작업이다.

| 순위 | 작업 | 완료를 확인할 기준 |
|---|---|---|
| P0-1 | crossing 유실/만료/지연의 복구 계약 | 100→98→102에서 98의 저장 유실·6초 지연·Stream trim을 각각 주입. 자동 복구 가능한 경우와 보류해야 하는 경우를 구분하고 처리 근거를 영속화 |
| P0-2 | 탈퇴의 Trading 차단 시점과 복구 | 전달 지연/실패 중 기존 JWT 주문·계정 생성·재시작·WS를 시도. 제품이 정한 차단 ACK 이후 모두 차단, 중복 전달 시 재정산 없음 |
| P0-3 | 실제 통합 시나리오 | Google/Kakao 각각 가입→새로고침→다중 탭 갱신→거래→재본인확인→탈퇴→재가입을 실제 브라우저에서 완료. 계정·이력 혼합 없음 |
| P1-1 | 방향별 레버리지 | LONG만 변경했을 때 SHORT와 타 종목의 담보/청산가 불변. quote/예약/추가 체결/수수료/경합도 동일 계약 |
| P1-2 | 거절 이유의 지속 표시 | 토스트와 주문 행에서 같은 안전한 원인 문구. 모든 거절 코드와 알 수 없는 code fallback 테스트 |
| P1-3 | 한 계정 실패의 격리·대사 | 실패를 반복 주입해 전체 작업 무기한 정지 방지. 보류 계정의 순서·잠금·재개를 검증하고 원장 불일치가 자동 수정되지 않음 |
| P1-4 | 장기 탈퇴 진행 재접속 | 15분 초과·탭 종료·응답 유실 후 본인 확인으로 상태만 복구. 일반 API 권한은 복원하지 않음 |
| P1-5 | 성과/포트폴리오 집계 계약 | LONG/SHORT 합산, 기간·회차·수수료·조정·관리종료·페이지 경계·재시작을 포함한 서버 집계 검증 |
| P1-6 | 정책/브라우저/빌드 계약 | 개발 초안 정리, 재동의의 서버 강제 여부 결정, SameSite·Web Locks 실브라우저 확인, 기본 빌드 실패 해결 또는 검증된 빌드 방식 명시 |
| P2 | 로그/UX/문서 정리 | 안전한 오류 추적 ID, 중요 알림 보존, 모의정책 설명, 낡은 README 설명 정리 |

### 엔진 검증에서 특히 필요한 시나리오

1. 접수된 지정가가 잠깐 crossing 후 반등하고 worker가 6초 늦게 처리하는 경우.
2. 청산가를 잠깐 통과한 Mark가 Stream에 없거나 만료되고 현재가는 회복한 경우.
3. 한 tick의 앞 계정은 fresh, 뒤 계정은 만료가 되는 처리 지연.
4. 한 계정의 반복 예외가 다른 계정의 청산까지 막는 경우.
5. LONG/SHORT 동시 레버리지 변경·체결·부분 종료·강제청산·탈퇴 경합.
6. 같은 키 재조회와 응답 유실 후 브라우저 새로고침에서 중복 주문 방지.
7. 증거금+수수료 경계에서 여러 주문을 동시에 접수하고 예약·체결 후 전 계정 대사.
8. 강제청산 뒤 남은 진입 지정가가 새 Position을 여는 정책과 사용자 안내 일치.
9. 개인 WS 재연결·토큰 회전·중복 이벤트·초기 baseline 중 발생한 신규 체결의 누락 여부.
10. 탈퇴 전달 성공/Content 최종화 실패/재전송/동시 재가입에서 과거 계정 재활성화 금지.

관련 항목 중 일부는 이미 자동 테스트가 있다. 기존 테스트를 중복 작성하기보다 유실·만료·장시간 처리·실제 브라우저 연결의 빈틈을 채우는 것이 효율적이다.

### 부하 측정 항목

활성 계정·종목·계정당 포지션/미체결 수·초당 Mark 수를 입력 조건으로 고정하고, 수신→체결 commit 지연 p50/p95/p99, 가장 오래된 미처리 tick 나이, 계정 lock 대기/timeout 비율, DB 조회 수, 재처리 횟수와 누락/중복 정산 수를 측정한다. 특히 p99만 보지 말고 **5초 유효기간을 넘긴 위험 작업의 수와 최장 지연**을 확인해야 한다. 목표 지연값은 제품 기준으로 새로 정하되 이번 보고서에서 실측 성능처럼 제시하지 않는다.

## 11. 모의투자에서 유지해도 되는 단순화

- 실제 호가를 소모하지 않고 서버 Mark로 전량 체결.
- 실제 거래소와 다른 고정 모의 수수료.
- 고정 유지증거금률과 전량 격리 청산.
- 실자금 입출금, ADL·보험기금·실거래소 단계적 청산, 고급 주문 종류를 범위에서 제외.
- 재도전/탈퇴 시 가짜 매매 대신 관리상 종료와 자본조정을 별도 기록.

펀딩비·슬리피지·거래소별 위험구간을 추가해야만 운영 가능한 것은 아니다. 장기 보유나 랭킹을 실제 선물 성과처럼 비교하려면 이런 차이를 명확히 설명해야 한다. 반면 중복 체결, 다른 사용자의 자산 접근, 수수료 누락, 원장 불일치, 조용한 청산 누락은 모의투자라는 이유로 허용할 단순화가 아니다.

## 12. 최종 운영 판정

현재는 **핵심 인증과 거래 정합성은 상당 부분 갖췄으나, 예외 상황의 복구와 요청한 제품 경험의 완성이 남은 단계**다. 기존 잠금·원장·이벤트 구조를 버리고 엔진을 새로 만들 이유는 확인하지 못했다. 우선 가격 위험 이력의 처리 보장, 탈퇴 차단 계약, 실제 통합 시나리오를 보강한 뒤 방향별 레버리지·오류 이유·성과 집계를 완성하는 순서가 적절하다.

901개 테스트 통과는 좋은 근거다. 다만 그 숫자만으로 유실된 가격의 복원이나 실제 소셜 로그인·운영 부하까지 증명되지는 않는다. 점수를 높이는 가장 빠른 방법은 기능 수를 늘리는 것이 아니라, 위 P0/P1의 구체적 반례를 재현하고 시스템이 어떤 결과로 수렴하는지 검증하는 것이다.
