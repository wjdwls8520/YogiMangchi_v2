# Backend 회원 생애주기·동의·모의투자 회차 보강 결과

## 기존 분석과 재사용

기존 Content는 Google/Kakao 증명·JWT/Refresh·기본 프로필·팔로우·탈퇴 outbox가 있었다.
다만 버전 동의가 없고, 탈퇴 시 닉네임/OAuth 신원이 남았으며 Content가 Trading 차단보다 먼저 탈퇴를 확정했다.
기존 Trading 회원은0잔액, Guest retry는 존재하나 회원 회차/24시간 제한/회차 원장 연결은 없었다.
기존 AccountLock·생성 Advisory lock, 관리상 종료와 예약 해제, Order 상태 전이·격리 체결 엔진·영속 TradingEvents를 재사용했다.
Java17/Spring Boot3.5.x/Gradle/PostgreSQL/Redis와 기존 의존성을 유지했다. 신규 의존성은 없다.

## 구현 항목

1. **Content 변경**: WITHDRAWING 처리 중 상태, 동일 회원 최근 OAuth 증명+CSRF+확인 본문, 기존 Access 회원 기능 차단,
   Trading 확인 후 개인정보 파기·WITHDRAWN 확정, 완료/처리 중 상태 조회와 영속 재전송.
2. **개인정보 파기 범위**: nickname NULL/profileMessage 빈 값, OAuthIdentity(이메일/provider/subject), Refresh 해시·계열,
   불필요한 consent history/이전 동의 시각을 제거한다. Member ID·상태·시각·최소 확인 버전/시각·업무 원장은 남긴다.
   실제 없는 이미지/파일/커뮤니티를 파기했다고 주장하지 않는다. 다른 기기의 임시5분 OAuth 증명으로 과거 계정을 복구할 수 없다.
3. **재가입**: PENDING 중에는 신원 연결을 유지해 혼합을 막고 flow=WITHDRAWAL_PENDING이다. 완료 후 동일 Google/Kakao도
   SIGNUP_REQUIRED가 된다. 새 동의·닉네임으로 새 memberId를 만들며 과거 거래/Guest 이력은 옮기지 않는다.
4. **약관/동의**: 종류별 ym-terms-v1/ym-privacy-v1 고정 개발용 본문/해시/버전, append-only 동의 서버 시각,
   현재/마지막 동의·재동의 상태 조회와 제출. 기존 미상 동의 버전을 위조하지 않는다. 동일 버전 재제출은 최초 이력을 보존한다.
5. **Trading 변경·최초 지급**: 신규 회원 계정/USDT Wallet/INITIAL_GRANT1회차10000을 하나의 Transaction으로 생성한다.
   Content 가입의 영속 provisioning outbox와 기존 명시적 회원 API는 같은 경로다. 반복 로그인/재전송/동시 생성으로 재지급하지 않는다.
6. **회차 구조**: Account/Wallet은 유지하고 member_trading_round/member_restart/member_round_retirement를 추가했다.
   Order/Fill/Position/TradingEvent는 명시적 불변 round_id를 갖는다. Guest는NULL이다. 종료 Wallet·잔여 원가/담보 스냅샷을 보존한다.
7. **재시작 제한**: DB clock와 member_restart 마지막 성공 시각+24시간. AccountLock 아래 다른 키 동시 요청도1회만 성공한다.
   같은 성공 Idempotency-Key는 원래 결과를 반환하며429에 nextAvailableAt을 제공한다. 첫 회차는 제한 횟수가 아니다.
8. **엔진 차단/정리**: 같은 잠금 아래 PENDING 취소·CLOSE 예약 반환·OPEN 관리상 종료·Wallet 노출 검증·새 회차 자금 조정을 원자적으로 처리한다.
   신규 Fill/PnL/fee를 만들지 않는다. Worker는 취소 주문/비활성 계정을 처리하지 않으며 새 회차 이전의 Mark를 새 회차 청산에 적용하지 않는다.
   가격 작업이 먼저 커밋하면 그 실제 Fill은 이전 회차에 보존된다. 금융 제약을 완화하지 않았다.
9. **포트폴리오 API**: 본인 `/api/v1/trading/account/rounds[/current|/{roundId}]` 및 회차별 orders/fills/positions,
   ID 커서/limit, typed DTO, Decimal 문자열과 서버 시각. 완료 회차는 현재 가격으로 재계산하지 않는다. 다른 회원/과거 회원 ID로 접근404.
10. **개인 이벤트**: HTTP/WS에 roundId/roundNumber를 넣어 과거 회차 이벤트를 구분한다. 기존 eventId 재전송 계약은 유지한다.
    Frontend는 현재 회차 상태를 재조회하고 과거 round 이벤트로 현재 화면을 덮어쓰지 않아야 한다.
11. **장애/복구**: Content HTTP는 DB Transaction 밖에서 수행하고 타임아웃·최대300초 지연 재전송·10건 배치를 유지한다.
    생성/탈퇴 토큰은 전용 token_use/audience/60초/서명/path subject로 분리한다. Trading 커밋 후 Content 실패는 PENDING 재전송으로 복구한다.
    Content 최종 탈퇴 확정은 Trading 정리 커밋 후다. 전달 전 PENDING을 이미 거래 차단된 상태라고 주장하지 않는다.
12. **마이그레이션**: Content V4__consent_and_private_withdrawal.sql, Trading V17__member_rounds.sql.
    기존 migration은 변경하지 않았다. 기존 금융 기록은 확인된 단일 pre-round 생애주기의 LEGACY_UNVERIFIED 초기 회차로 연결하고
    최초 지급액은NULL로 남긴다. 잔액·체결가·수수료·손익은 유지한다.0잔액 일괄 지급/계정 초기화를 하지 않는다.
13. **운영 전 검토**: 실제 DB 백업/복구 리허설, writer 중지·배포 창, 대량 backfill/index/FK 잠금 시간,
    Trading V17/API→Content V4 순서, 전송 활성/신뢰 URL·키, 기존 비공식 reset 이력 여부와 별도 자금 이관 대상 확인이 필요하다.
    V4는 이미 완료된 탈퇴 회원의 불필요한 개인정보도 파기한다. 앱 rollback만으로 이를 복구할 수 없다.
    실제 사용자 DB/Volume은 이번 작업에서 변경하지 않았다.
14. **정책 문구**: 사용자 답변에 따라 개발용 초안으로 제공했다. 운영자/문의처/담당자/위탁·국외 처리/보유·백업·로그 정책과 시행일은
    공개 운영 전에 확정해야 한다. 확인되지 않은 연락처·법정 기간을 만들어 넣지 않았으며 법적 검토 완료를 주장하지 않는다.
15. **경계**: Frontend/루트 인프라/Next.js 보안 업데이트에는 관여하지 않았다. 커뮤니티·게시글·멘션은 향후 memberId 유지/탈퇴한회원 표시 계약만 기록했다.
    기본 기술·새 외부 의존성·Guest 정책은 변경하지 않았다. 루트 문서의 이전0잔액 설명은 최신 승인 정책보다 앞선 내용이며 이번 범위에서 수정하지 않았다.

## 검증

- Content: Java17 `clean build` 성공, 전체97개 테스트 실패/오류/건너뜀0.
- Trading: Java17 `clean build` 성공, 전체557개 테스트 실패/오류/건너뜀0.
- 최종 missing-wallet migration guard 보강 후 `test --tests '*MemberJwtIntegrationTests' build` 성공, 핵심30개 재검증. 이30개는 전체 수에 중복 포함된 테스트다.
- 기존557+97=654개 독립 테스트 범위를 검증했다. 실행 중단 기간의 PostgreSQL 테스트 컨테이너 시작 실패7건은 Docker 정상 상태에서 전체 재실행하여 해소했다.
- 가입/필수 버전 동의/outbox rollback, 미상 동의·재동의 기록, 문서 해시/불변성, 실제 CSRF/탈퇴 문구/동일 OAuth 증명,
  Google·Kakao 재가입/닉네임 재사용, Refresh 폐기·Access 차단·동시 signup/refresh/미커밋 신원 파기/재가입을 검증했다.
- 초기 지급·동시 생성/탈퇴,2·3회차,동일/서로 다른 키 동시 요청,24시간,타 계정/Guest 차단,rollback/DB lock timeout,
  가격/청산/주문/취소/조회/탈퇴 경합,이전 Mark 재처리,부분 청산 후 원가·수수료 보존,회차 DTO/OpenAPI와 V3→V4/V16→V17 이관을 검증했다.
- 기존 migration/AGENTS, Frontend와 루트 인프라 변경이 없음을 diff로 확인했다. 중복 회원/초기 지급/Fill·원장 정합성 제약을 완화하지 않았다.

독립 서비스 검증이며 외부 Google/Kakao/Binance 가용성에 의존하지 않는다. 실제 OAuth 및 Frontend+Content+Trading 전체 시나리오는
사용자 지시에 따라 두 Work의 develop 통합 뒤 별도 단계로 남겼다. 실제 클라우드/백업 파기·운영 부하 측정은 수행하지 않았다.

## Frontend 전달

- [Content 가입·정책 조회·재동의·확인 탈퇴·상태 및 재가입 계약](member-lifecycle.md)
- [Trading 최초 지급·회차·재시작·원장·이벤트 및 이관 계약](../../trading-server/docs/member-rounds.md)
- 실제 Swagger/OpenAPI는 각 서비스의 local `/v3/api-docs`, prod 외부 비공개다. 새 경로·typed DTO·버전/인증/429 계약을 반영했다.
- 기존 무본문 탈퇴와 버전 없는 가입 요청은 새 Backend 계약에 맞춰 Frontend Work에서 변경해야 한다.

## Git과 변경 파일

브랜치 `feature/backend/member-lifecycle`. 서비스별 기능 커밋과 검증/보고 커밋으로 구분한다.
PR을 준비하며 develop/master에는 이 Work에서 머지하지 않는다. 기존 Frontend 작업 트리는 보존한다.
PR URL과 최종 커밋은 Work 완료 메시지에 보고한다.

- `content-server/README.md`
- `content-server/docs/backend-change-report.md`
- `content-server/docs/member-lifecycle.md`
- `content-server/src/main/java/com/yogimangchi/content/auth/controller/AuthController.java`
- `content-server/src/main/java/com/yogimangchi/content/auth/dto/SignupRequest.java`
- `content-server/src/main/java/com/yogimangchi/content/auth/repository/RefreshSessionRepository.java`
- `content-server/src/main/java/com/yogimangchi/content/auth/security/ActiveMemberFilter.java`
- `content-server/src/main/java/com/yogimangchi/content/auth/security/SecurityConfig.java`
- `content-server/src/main/java/com/yogimangchi/content/auth/security/WithdrawalCsrfFilter.java`
- `content-server/src/main/java/com/yogimangchi/content/auth/service/AuthService.java`
- `content-server/src/main/java/com/yogimangchi/content/consent/ConsentController.java`
- `content-server/src/main/java/com/yogimangchi/content/consent/PolicyConsents.java`
- `content-server/src/main/java/com/yogimangchi/content/member/controller/MemberController.java`
- `content-server/src/main/java/com/yogimangchi/content/member/dto/WithdrawalRequest.java`
- `content-server/src/main/java/com/yogimangchi/content/member/entity/Member.java`
- `content-server/src/main/java/com/yogimangchi/content/member/service/MemberProvisioning.java`
- `content-server/src/main/java/com/yogimangchi/content/member/service/MemberProvisioningDelivery.java`
- `content-server/src/main/java/com/yogimangchi/content/member/service/MemberWithdrawals.java`
- `content-server/src/main/resources/db/migration/V4__consent_and_private_withdrawal.sql`
- `content-server/src/test/java/com/yogimangchi/content/auth/AuthIntegrationTests.java`
- `content-server/src/test/java/com/yogimangchi/content/auth/ProdSecurityIntegrationTests.java`
- `content-server/src/test/java/com/yogimangchi/content/member/MemberFollowIntegrationTests.java`
- `content-server/src/test/java/com/yogimangchi/content/member/MemberLifecycleIntegrationTests.java`
- `content-server/src/test/java/com/yogimangchi/content/member/MemberProfileIntegrationTests.java`
- `content-server/src/test/java/com/yogimangchi/content/member/MemberWithdrawalIntegrationTests.java`
- `content-server/src/test/java/com/yogimangchi/content/member/NicknamePolicyTests.java`
- `content-server/src/test/java/com/yogimangchi/content/member/UnicodeNicknameIntegrationTests.java`
- `trading-server/README.md`
- `trading-server/docs/member-rounds.md`
- `trading-server/src/main/java/com/yogimangchi/trading/error/ApiExceptionHandler.java`
- `trading-server/src/main/java/com/yogimangchi/trading/error/ErrorCode.java`
- `trading-server/src/main/java/com/yogimangchi/trading/execution/trigger/AccountTriggerService.java`
- `trading-server/src/main/java/com/yogimangchi/trading/order/entity/TradingOrder.java`
- `trading-server/src/main/java/com/yogimangchi/trading/position/entity/Position.java`
- `trading-server/src/main/java/com/yogimangchi/trading/security/SecurityConfig.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/controller/MemberAccountController.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/controller/MemberWithdrawalController.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/dto/MemberAccountResponse.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/entity/TradingAccount.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/entity/Wallet.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/security/WithdrawalSecurity.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/service/MemberAccounts.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingaccount/service/MemberWithdrawal.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingevent/dto/TradingEventResponse.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradingevent/service/TradingEvents.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradinground/MemberRoundController.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradinground/MemberRounds.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradinground/RestartLimited.java`
- `trading-server/src/main/java/com/yogimangchi/trading/tradinground/RoundLedger.java`
- `trading-server/src/main/resources/db/migration/V17__member_rounds.sql`
- `trading-server/src/test/java/com/yogimangchi/trading/tradingaccount/MemberJwtIntegrationTests.java`
- `trading-server/src/test/java/com/yogimangchi/trading/tradingsymbol/TradingSymbolIntegrationTests.java`
