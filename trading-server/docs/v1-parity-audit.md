# V1 → V2 Backend 기능 이식 기준표

## 현재 V2 범위 — 과거 조사표보다 우선

2026-10-22 사용자 정정: V1을 그대로 따라하거나 모든 기능을 복원하는 작업이 아니다.
현재 V2 구조·기존 구현·승인한 제품 정책을 기준으로 실제 필요한 누락 기능만 보완한다.
아래 Phase0 표의 MISSING은 V1과의 과거 차이를 뜻하며 V2 구현 의무를 뜻하지 않는다.

| 항목 | 현재 V2 결정 |
|---|---|
| U07 별도 이메일 추가 인증 | 제외. Google/Kakao 신원 확인 과정의 기존 공급자 이메일 검증과 구분 |
| U08 거래 해금 퀘스트 | 제외. V1의 인증/체결 횟수 조건을 거래 차단 정책으로 도입하지 않음 |
| A01 재도전 | 같은 Guest 사용자/계정 ID를 유지한 자금 초기화. V1 회원 MOCK 참가·포기 구조를 복제하지 않음 |
| A02 회원 자금/지갑 확장 | 현재 Guest 경험보다 먼저 구현할 우선 작업이 아님. 기존 회원 Backend 기반은 보존 |
| A04/A05 투자 성과·수익률·공개 포트폴리오 | 후속 작업. 기존 주문/Wallet 평가·손익 계산을 제거한다는 뜻은 아님 |

현재 Guest 기본 자금은10000 USDT이며 `POST /api/v1/trading/account/retry`로 같은 Guest ID를 유지한 재도전을 제공한다.
대기 주문 취소·열린 포지션 행정 종료·예약 해제·현금 초기화·재도전 기록을 같은 Transaction으로 처리한다.
요청 키로 재전송을 멱등 처리하며 토큰/만료/과거 금융 이력은 보존한다. 투자 성과 API는 추가하지 않는다.

## 기준과 완료 범위

- 조사일: 2026-10-20.
- V1: `main`, `a3391b523356d0f44cfec21cb302e326f52b6db3`. 별도 임시 사본만 읽었다. V1 파일·원격은 변경하지 않았다.
- V2: `origin/develop`, `2abaf45b149a5bc1cb4e4d01af1f5750af814e92`.
- 이 표는 **Phase 0 조사 기준**의 차이를 보존한다. 아래 후속 진행 기록으로 구현 여부를 갱신하며 전체 이식 완료와 개별 Phase 완료를 구분한다.
- V1 Controller 34개 / HTTP 매핑 142개 / Frontend API 모듈과 소비 화면을 조사했다. 개별 경로·메서드·소비자 증거는 [전체 API 목록](v1-api-inventory.md)에 있다.
- V1은 실행하지 않았다. 정적 코드의 동작 근거와 실제 서비스의 정상 실행 검증을 구분한다. OAuth·메일·S3·운영 권한·과거 배포 상태는 UNVERIFIED다.

사용자 의도는 **V1 제품 기능을 복원하되 V2 아키텍처를 유지**하는 것이다. Hedge 통합 포지션, 종목별 공유 1~100배, PostgreSQL 원장, 서버 Mark Price, Redis, 잠금·멱등성·복구를 유지하고 최종 선물 정책은 **Isolated Only**다. V1 코드 복사, Frontend 금융 정산, Cross 선택 기능은 목표가 아니다.

## 정책 충돌과 경계

이번 명시적 요청은 루트 README의 V1 참고 금지/대회로 단순화, Trading AGENTS의 Spot 제외/Cross 설명보다 우선한다. 이것이 기존 코드가 이미 Isolated라는 뜻은 아니다. 루트 파일과 Frontend는 이번 변경에서 읽기 전용으로 유지했다. 후속 구현과 함께 기존 문서의 실제 상태를 갱신해야 한다.

Content는 회원/OAuth/프로필/커뮤니티/팔로우/신고/Content 알림을 소유한다. Trading은 선물/현물 가상 금융 원장/지갑/대회/성과/Trading 알림을 소유한다. 회원을 JPA 관계로 공유하거나 Content 테이블을 직접 읽지 않는다. Content 신규 애플리케이션과 루트 인프라 변경은 **별도 범위 승인 필요**다. Spot은 Trading 내부 별도 도메인으로 설계하고 Futures 증거금 모델을 재사용하지 않는다.

판정: `PARITY`는 아래에 적은 핵심 코드 동작의 동등성이지 V1 실행 재현 완료가 아니다. `PARTIAL`, `BEHAVIOR_MISMATCH`, `MISSING`은 미완료다. `V2_IMPROVEMENT`는 보존 대상이며 V1 필수 기능이 아니다. `UNVERIFIED`는 정상 지원 근거가 부족하다.

## 코드/화면 근거 약어

V1 Java 경로는 `was/src/main/java/com/yogimangchi/` 기준, V2 Java는 `trading-server/src/main/java/com/yogimangchi/trading/` 기준이다. 각 행의 근거 파일과 API는 [동일 커밋의 API 목록](v1-api-inventory.md)에서 상세 경로로 연결된다.

| 그룹 | V1 업무 구현 / Entity·Repository | V1 API → 실제 Frontend 소비 흐름 | V2 대응 구현 |
|---|---|---|---|
| F | `domain/futures/service/FuturesOrderService`, `FuturesLimitOrderService`, `FuturesPositionService`, `FuturesLeverageService`, `FuturesQueryService`; `entity/FuturesPosition`, `FuturesOrder`; `repository/query/*` | `/api/v1/futures/*` → `web/lib/api/futures.ts` → `web/hooks/useFuturesTradingSession.ts`, `web/components/futures/trading/*`, `web/app/(default)/assets/page.tsx` | `execution/TradingOrderService`, `execution/trigger/AccountTriggerService`, `position/*`, `leverage/*`, `tradingaccount/*`, `order/*`, `fill/*` |
| S | `domain/spot/service/SpotOrderService`, `LimitOrderExecutionService`, `SpotOrderQueryService`, `SpotTradeHistoryQueryService`; `entity/Order`, `Holding`, `TradeHistory`; `repository/*` | `/api/v1/{mock,real}/spot/*` → `web/lib/api/trade.ts` → `web/components/trade/OrderForm.tsx`, `UserOrderHistory.tsx`, mock/trading/assets 화면 | 없음 |
| A | `domain/asset/service/MockAssetService`, `RealAssetService`, `PortfolioCalculationService`; `domain/real/service/AssetTransferService`; `domain/portfolio/service/PortfolioService`; Assets/Holding/TransferHistory 및 각 Repository | `/asset/mock/*`, `/asset/real/detail`, `/real/assets/*`, `/portfolio/*` → `web/lib/api/{asset,trade,portfolio}.ts`, `web/components/asset/AssetTransferModal.tsx`, assets/member/me 화면 | Guest `tradingaccount/*` 만 존재 |
| U | `global/auth/oauth/*`, `global/auth/jwt/*`, `domain/auth/service/*`, `domain/member/service/*`; Member/OAuthAccount/UserQuest/WithdrawnOAuthAccount/MemberFavoriteSymbol/MemberFollow 및 각 Repository | `/auth/*`, `/member/*`, `/favorites/symbols` → `web/lib/api/member.ts`, `favorite.ts`, AuthBootstrap/login/signup/verify/me/settings, profile/sidebar, CoinList | Guest `tradingaccount/security/*`, `security/SecurityConfig`만 존재 |
| C | `domain/contest/service/*`, `domain/futures/controller/Contest*`; ContestSeason/Applicant/RejectedApplicant/Participant/SettlementPriceSnapshot/SettlementRun 및 각 Repository | `/contest/*`, `/me/contest/*`, `/admin/contest/*`, `/futures/contest/*` → `web/lib/api/{contest,contest-futures,admin-contest}.ts`, `useContestFuturesTradingSession`, contest/admin/assets/profile 화면 | 없음 |
| B | `domain/community/service/*`, `facade/*`, `validator/*`, `domain/report/service/ReportService`; Post/Reply/Like/Report/File 및 각 Repository | `/community/*`, `/me/community/*`, `/me/reports/*`, `/report/type/community`, `/admin/community/*` → `web/lib/api/{post,post.server,me-community,admin-community}.ts`, community/me/member/admin 화면 | 없음 |
| N | `domain/notification/service/NotificationService`, `NotificationSseService`; Notification/NotificationGroupState 및 각 Repository,`global/sse/enums/*` | `/notifications/*` → `web/lib/api/notifications.ts`, `web/app/SSEProvider.tsx`, `web/components/notifications/*`; 각 업무의 afterCommit 호출 | 개인 계정 이벤트 없음. 시장용 `marketdata/websocket/*`과 혼동하지 않음 |
| M | `domain/market/*`, `domain/chartapi/*`, `domain/chartist/*`; FuturesSymbolPolicy/가격 Repository | `/market/*`, `/chartapi/*`, `/chartist/seasons/{seasonId}/results` → `useBinanceWebSocket`, `useBinanceTickers`, CoinChart/CoinHeader/CoinList, rank/community sidebar | `tradingsymbol/*`, `binance/*`, `marketdata/*`, `execution/trigger/*` |

## 기능별 비교 및 이식 작업

각 행은 위 그룹의 Backend/API/Frontend 근거를 상속한다. 의존성의 숫자는 요청서 Phase다. 검증은 후속 구현의 완료 조건이며 이번 조사에서 통과한 기능 테스트라고 주장하지 않는다.

| ID / 기능 | 그룹 / 상태 | 확인한 동작과 차이 | 필요한 Backend / Frontend 변경 | 의존·우선순위 | 필수 검증 |
|---|---|---|---|---|---|
| F01 Market OPEN LONG/SHORT | F / PARITY | 서버 가격·Order·Position·Wallet 변경 흐름 존재. V1 ticker/수수료와 V2 Mark/무수수료 차이는 별도 행 | 기존 V2 체결 재사용 / 계약 유지 | 1→2 / P0 | 양방향·재시도·롤백 |
| F02 Limit OPEN | F / BEHAVIOR_MISMATCH | V1 지정가 체결가, V2 현재 Mark 체결. 둘 다 PENDING 후 트리거 | V2 Mark trigger 유지, 모의 maker 의미 문서화 / 표시 변경 | 1→2 / P0 | crossing·갭·체결 시 재검증 |
| F03 Hedge 동시 보유 | F / PARITY | 동일 종목 LONG/SHORT 동시 OPEN | 단일 side lifecycle 유지 / 양쪽 표시 | 1 / P0 | 반대 방향 보존 |
| F04 동일 방향 합산·평균가 | F / PARITY | V1 addEntry, V2 exact entryNotional 기반 합산 | V2 정밀 원가 재사용 / 서버 평균가 사용 | 1 / P0 | 추가진입·부분청산 후 재진입 |
| F05 레버리지 정책 | F / BEHAVIOR_MISMATCH | V1 방향별·DB 종목별 최대치, V2 종목 공유 1~100 | 요청대로 V2 공유 정책 유지 / ISOLATED 응답 수용 | 1 / P0 | 1/10/14/100, 양방향 원자 변경 |
| F06 증거금 재배분 | F / PARTIAL | V2 used/reserved 재배분은 있으나 위험은 Cross | 격리 담보·각 방향 안전성 검사 / 최신 margin·예상가 표시 | 1 / P0 | 부족·즉시 위험 거절·예약 OPEN |
| F07 포지션 격리 위험 | F / BEHAVIOR_MISMATCH | V1 포지션 단위, V2 계정 equity와 gross MM | 포지션 equity/MM 평가 신설, 계정 risk 청산 제거 / isolated 명시 | 1 / P0 | 타 종목·반대편·미사용 현금 비보전 |
| F08 청산 예상가 | F / BEHAVIOR_MISMATCH | V1 entry*(1±1/L∓0.0005); V2 Cross 조건부 수치 | 표시·엔진 동일한 격리 공식 / 모드·상태 기준 전환 | 1 / P0 | 임계 앞/뒤 1 ULP, null·1배 |
| F09 자동 강제청산·재처리 | F / BEHAVIOR_MISMATCH | V1 해당 포지션만, V2 계정 전 포지션+예약 주문 정리 | 해당 포지션 CLOSE 예약만 정리 / 개별 이벤트 연동 | 1 / P0 | 동시 두 방향 위험·한 번만 Fill |
| F10 청산 갭 정산 | F / BEHAVIOR_MISMATCH | V1 저장 청산가로 정산, V2 실제 Mark로 지갑 손실 반영 | 격리 한도 초과 손실의 명시적 기록 필요 / 체결가·조정금 구분 | 1 / P0, 정책 게이트 | 급락·급등·재시작 gap·지갑 보전 |
| F11 Market 부분/전체 CLOSE | F / PARTIAL | V2 수량/예약 방어·비례 margin 반환 존재; 수수료 없음 | 격리 정산과 수수료 적용 / 서버 순수령액 사용 | 1→2 / P0 | 부분 2회→전량, 잔여 basis·담보 |
| F12 Limit 부분/전체 CLOSE | F / PARTIAL | V1 지정가, V2 Mark trigger; V2 예약 초과 거절 | 현재 수량 예약 불변조건 유지 / pending 갱신 | 1→2 / P0 | 1 BTC에 예약0.7+시장가0.5 거절 |
| F13 CLOSE 예약 수량 | F / V2_IMPROVEMENT | V1은 이후 최신 CLOSE부터 overflow 취소, V2는 접수 때 명시 예약 | V2 사전 예약 유지 / freeCloseQuantity 사용 | 1→2 / P0 | 취소/체결/추가진입 경합 |
| F14 Pending OPEN 담보 | F / PARTIAL | V2 margin만 예약, V1 fee 포함 차감 | 격리와 fee 예약 분리·합계 검증 / 비용 표시 | 1→2 / P0 | 더 유리한 체결·부족 거절·취소 반환 |
| F15 거래 수수료 | F / MISSING | V1 MARKET0.0005/LIMIT0.0003; V2 Fee 필드·차감 없음 | Order/Fill fee와 Wallet 정산 / fee·net 별도 표시 | 2 / P0 | OPEN/CLOSE·100% 비율·rounding |
| F16 강제청산 수수료 | F / BEHAVIOR_MISMATCH | V1 수수료를 가격 보정으로 설명하나 실행에서 별도 fee 차감 없음 | 임계값과 실제 부과의 구분 확정 / 서버 fee만 표시 | 1→2 / P0, 정책 게이트 | 이중 차감·가격 보정 위장 금지 |
| F17 주문 취소 | F / PARITY | V2 상태 전이·담보/수량 해제·소유권 검증 | 기존 경로 재사용 / idempotency 유지 | 2 / P1 | 취소↔체결 race |
| F18 주문 내역·필터 | F / PARTIAL | V1 cursor/size/symbol/상태, V2 beforeId/limit만 | 필터·cursor 계약 명시 / query 연동 | 3 / P1 | 접근권한·중복/누락 없는 페이지 |
| F19 체결 내역 | F / PARTIAL | V1 UI trades는 주문 조회 재사용; V2 Fill 영속·Order DTO 일부 포함 | 전용 Fill 조회와 fee/time 계약 / 별도 탭 | 3 / P1 | ORDER/FILL 식별·부분/강제청산 |
| F20 종료 포지션 생애주기 | F / MISSING | V1 closed 조회, V2 CLOSED/LIQUIDATED 이력은 DB에만 있음 | 전용 Position history API / lifecycle 기준 탭 | 3 / P1 | 3회 진입·2회 부분청산→종료1건 |
| F21 실현·미실현 손익 | F / PARTIAL | V2 원가·누적 PnL 존재; fee/gap 분리 없음 | gross PnL·fee·adjustment·net 계약 / 중복 차감 금지 | 1→3 / P0 | 원장 항등식·이력 합계 |
| F22 비동기 체결 알림 | N,F / MISSING | V1 afterCommit 개인 SSE·저장 알림, V2 요청 결과와 order polling뿐 | 인증 계정 이벤트·복구 cursor / toast 중복 제거 | 3 / P1 | 타 사용자 차단·재연결·commit 후 전송 |
| F23 신규 주문 최소 금액 | F / BEHAVIOR_MISMATCH | V1 server MIN_ORDER_AMOUNT10, 현재 V2 MIN_NOTIONAL1 USDT | Phase 2에서 fee 포함 비용·최소 금액 계약 정리 / 서버 제약 사용 | 2 / P1 | 최소 경계·부분 CLOSE 예외 |
| S01 현물 시장가 매수/매도 | S / MISSING | V1 수수료 포함 지출 BUY/보유량 SELL·평균가 갱신 | Spot ledger·Holding·Order/Fill / 별도 화면 연동 | 4→5 / P1 | 소유 현금·수량·정산 atomic |
| S02 현물 지정가·예약 | S / MISSING | BUY lockedMoney, SELL lockedQuantity, crossing 후 잔여 전량 체결 | Spot 예약/trigger 재사용 경계 / pending 표시 | 5 / P1 | 갭·재시작·예약 누수 |
| S03 현물 취소·이력 | S / MISSING | real/mock 각각 orders/open/histories/cancel 존재 | 회원/모의 계정 분리·cursor / 필터 연동 | 5 / P1 | 부분 매도·취소 race·권한 |
| S04 현물 부분체결 | S / UNVERIFIED | PARTIALLY_FILLED enum/조회는 있으나 실행은 getRemainingQuantity→completeOrder | 실제 지원으로 단정하지 않음; 호가 matching 도입 금지 / 상태는 실제 계약만 | 5 / P2 | 상태 생산 경로 확인 후 결정 |
| S05 보유 자산·평균 원가 | S,A / MISSING | Holding quantity/lockedQuantity/averageBuyPrice 존재 | Spot 상태·조회 / 자산 탭 | 5 / P1 | 예약 수량 포함 원가·영수증 합계 |
| A01 모의투자 참가·포기·재도전 | A / MISSING | MOCK 초기10000, retryCount, 중복 ACTIVE 방지, 포기 시 주문 정리 | V2 Guest를 삭제하지 않고 회원 MOCK 별도 / 참가·포기 UX | 4→5 / P1 | 중복 참가·이력 보존 |
| A02 본투자 Spot/Futures 지갑 | A,U / MISSING | 가입 시 Spot10000/Futures0 INACTIVE, 퀘스트 후 ACTIVE | 회원 지갑 생성 이벤트와 중복 방지 / 해금 상태 | 4→5 / P1 | 회원 데이터와 금융 소유권 |
| A03 자산 이체·내역 | A / MISSING | TRADE_SPOT↔TRADE_FUTURE만, requestId·ID순 lock | Trading 내부 두 ledger 이체 / transferable/history | 4→5 / P1 | 이중 이체·양방향 deadlock |
| A04 Wallet/Portfolio | A / PARTIAL | V2 Guest wallet/summary만; V1 현물+선물 통합·타입별 자산 | 회원/계정 분리·성과 읽기 모델 / 서버 평가액 사용 | 1→5 / P1 | equity·미수수료·평가불가 |
| A05 공개/자기 포트폴리오 | A,U / MISSING | V1 portfolio/me, /{memberId}; 지갑 없음204/회원 없음404 | Content 프로필→Trading 성과 API 조합 / 204 구분 | 4→5 / P2 | 공개 범위·자산 노출 정책 |
| U01 Google/Kakao OAuth | U / MISSING | V1 provider+providerUserId 식별·기존/신규 분기 | Content 생성 승인 필요; Trading은 JWT 로컬 검증 / OAuth 이동 | 4 / P1 | provider 토큰 오용·탈퇴 계정 |
| U02 소셜 가입·약관·닉네임 | U / MISSING | signupToken·약관·닉네임 lock·중복 방지, 비밀번호 가입 아님 | Content 전용 / 가입 흐름 | 4 / P1 | 단회 토큰·동시 닉네임·만료 |
| U03 JWT 갱신·로그아웃 | U / MISSING | V1 AuthService 실제 존재; login.md의 미구현 설명은 낡음 | Content Access/Refresh 정책 별도 확정 / 쿠키·보관 계약 | 4 / P1 | refresh 재사용·logout·CSRF |
| U04 Guest 경험 | U / V2_IMPROVEMENT | 7일 무작위 Bearer, Hash만 저장, 명시적 시작 | 유지; 회원으로 자동 합산 금지 / opt-in 유지 | 4 / P0 | credential 만료·소유권·비밀 로그 |
| U05 Guest→회원 귀속 | U / UNVERIFIED | V1 Guest 자체 없음, V2 회원 연결 없음 | 명시적 소유권 증명/승격 또는 별도 계정 정책 필요 / 동의 흐름 | 4 / 정책 게이트 | 탈취·다중 Guest·중복 병합 |
| U06 프로필 조회/수정 | U / MISSING | 닉네임/메시지/이미지 reset·업로드·보상 처리 | Content/S3 운영 방식은 별도 승인 / profile/settings | 4,7 / P1 | 이미지 실패 보상·개인정보 노출 |
| U07 이메일 인증·인증정보 | U / MISSING | 소셜 이메일 코드 발송/검증/완료, VERIFIED_USER | Content/메일 Secret·재시도 계약 / verify·settings | 4 / P1 | TTL·횟수 제한·동일 이메일 |
| U08 거래 해금 퀘스트 | U,A / MISSING | MOCK 체결3회+인증 회원, ADMIN 예외·지갑 활성화 | Content 자격/Trading 체결 이벤트 경계 / QuestModal | 4→5 / P1 | 중복 이벤트·해금 누락 복구 |
| U09 회원 탈퇴·재가입 제한 | U / MISSING | soft withdraw·OAuth tombstone·토큰/이메일 정리·후속 청크 | Content→Trading 명시적 업무 계약 / 재인증·탈퇴 UI | 4,7 / P1 | 미결 금융 보존·부분 실패 복구 |
| U10 관심 종목 | U / MISSING | 추가/삭제/목록 API, CoinList 소비 | Content 회원 선호, TradingSymbol ID 계약 / 목록 저장 | 7 / P2 | 중복·비활성 종목·소유권 |
| U11 팔로우·팔로워 | U,B / MISSING | 추가/해제·양쪽 cursor 목록·알림 | Content / profile·FollowMembersModal | 7 / P2 | 자기 팔로우·중복·탈퇴 |
| U12 회원 관리 | U / MISSING | ADMIN 목록 검색·강제 탈퇴 | Content ADMIN 인증 확정 후 / AdminGuard·users | 4,7 / P1 | USER 접근403·금융 이력 보존 |
| C01 대회 생성·수정·상태 | C / MISSING | admin season CRUD 중 생성/수정/상태 지원; 물리삭제 API 없음 | Trading competition+ADMIN JWT / admin contest | 4→6 / P1 | 일정·수정 가능 상태·권한 |
| C02 모집/진행/종료 조회 | C / MISSING | public 세 목록·인증 모집·상태 목록 | Trading public DTO / contest 목록 | 6 / P1 | 공개/비공개·기간 경계·cursor |
| C03 참가 신청 | C / MISSING | 중복 applicant/participant 거절·내 pending 목록 | Trading memberId 자격 계약 / 신청 결과 | 4→6 / P1 | 동시 신청·탈퇴·기간 |
| C04 승인/거절·이력 | C / MISSING | ADMIN participant 생성/전용 지갑·거절 사유·알림 | Trading admin 서비스 / members manager | 6 / P1 | 중복 승인·rollback·타 시즌 침범 |
| C05 대회별 계정·지갑 | C / MISSING | 승인 시 CONTEST 지갑 생성, 다른 지갑 분리 | 기존 engine+Account/Rule 사용 / 계정 선택 | 1,2,4→6 / P0 | Guest/회원/시즌 완전 분리 |
| C06 대회 선물 주문 | C,F / MISSING | contest market/limit open/close/cancel/leverage/조회 | Isolated engine 공유·종목별 제한 / contest-futures 계약 | 1,2→6 / P0 | 시즌 종료 차단·rule 최대 leverage |
| C07 참가/거절/결과 자기 조회 | C / MISSING | me/contest 4경로, member 참여·개별 결과 | Trading 조회 / assets·profile·contest UX | 6 / P1 | 결과 전409·타인 접근 |
| C08 순위·성과 | C,M / MISSING | 종료 final PnL·profitRate·공동 순위(1,1,3) | Trading 불변 결과 / rank·sidebar | 6 / P1 | 동률·수수료 반영·0 seed |
| C09 자동/수동 종료·정산 | C / MISSING | scheduler+단계 run/snapshot/registry/deactivate/close/aggregate | 동결→예약 정리→청산→결과, 재시작 가능한 단위 / 종료 표시 | 1→3,6 / P0 | 중간 실패·대량 cursor·중복 실행 |
| C10 종료 결과·종료 Wallet | C / MISSING | public/회원/자기 결과·finished wallet 존재 | Trading 결과 스냅샷 유지 / 종료 후 거래불가·조회 | 6 / P1 | 정산 후 가격 변동에 결과 불변 |
| C11 차티스트 결과 | C,M / MISSING | 별도 수익 예측 엔진이 아닌 종료 대회 final_* 순위 DTO | 별도 도메인 추측 금지·대회 결과 재사용 / rank 연동 | 6 / P2 | cursor·미정산 빈 결과 |
| B01 글 목록/상세/작성/수정/삭제 | B / MISSING | keyword/search·cursor·작성자·multipart·soft delete | Content / community 화면·SSR | 7 / P1 | 소유권·삭제 제외·첨부 제한 |
| B02 검색 | B / MISSING | PostSearchDto.keyword, PostRepository 제목·내용 검색 및 cursor 구현 | Content 검색 파라미터 / 검색 호출 연동 | 7 / P2 | 검색어 변경·페이지 누락 |
| B02a 카테고리/주간 인기글 | B / UNVERIFIED | UI all/best/latest 탭은 있으나 모두 같은 getPostsServer() 호출. 실제 인기/카테고리 분류 API 근거 없음. Top5는 종료 대회 순위임 | V1 완성 기능으로 단정하지 않음 / V2 추가 기획과 구분 | 별도 / P2 | 실제 정렬·분류 구현 근거 확인 |
| B03 댓글/대댓글·대상 지정 | B / MISSING | parent/target 검증·작성/수정/삭제·자식 조회 | Content / CommentContainer | 7 / P1 | 부모/게시글 불일치·탈퇴·삭제 |
| B04 글/댓글 좋아요 | B / MISSING | 중복 방지·해제·내 liked 목록·그룹 알림 | Content / LikeButton·내 활동 | 7 / P2 | 동시 중복·자기 알림 제외 |
| B05 신고·취소·내역·사유 | B / MISSING | post/reply report·사유 타입·내 신고 목록 | Content / ReportModal·내 활동 | 7 / P1 | 중복·취소·잘못된 대상 |
| B06 회원별 활동 | B,U / MISSING | 작성글/댓글·좋아요·신고·팔로우 | Content / me/member community | 7 / P2 | 본인/공개 정보 분리 |
| B07 커뮤니티 실시간 피드 | B,N / MISSING | public UX_COMMUNITY_POST_CREATED SSE·heartbeat | Content 피드; 개인 금융 WS와 분리 / 새 글 배너 | 7 / P2 | 재연결·중복·익명 정보 |
| B08 커뮤니티 운영 | B / MISSING | ADMIN 글/댓글 검색·탈퇴/활성 작성자 필터·삭제 | Content 운영 API / admin/community | 7 / P1 | 권한·상태전이·감사 기록 |
| B09 첨부·프로필 이미지 | B,U / MISSING | 관리 S3 업로드·rollback 정리·관리 이미지 삭제 | Content 저장 수단 필요성/운영 영향 승인 / multipart | 4,7 / P1 | 악성 파일·용량·외부 실패 |
| N01 알림 목록·상태·확인 | N / MISSING | cursor·미확인 수·lastChecked·그룹 상태 | 각 서비스 소유·Frontend 통합 / drawer·center | 3,7 / P1 | 타인 차단·그룹 갱신·cursor |
| N02 읽음/전체/선택/삭제 | N / MISSING | V1 일부 물리 삭제; V2 이력 보존 정책 검토 필요 | 사용자 숨김과 금융 사실 보존 분리 / center action | 3,7 / P1 | 반복 요청·미확인 항목 보존 |
| N03 금융/이체/대회 SSE | N / MISSING | 체결·청산·이체·승인·거절 afterCommit 영속 알림+SSE | Trading 계정 인증 채널·재전송 / SSEProvider 대응 | 3,5,6 / P1 | 도중 종료·반복 전송·소유권 |
| N04 댓글/좋아요/팔로우 알림 | N,B / MISSING | 개인/그룹·dedupe·actor preview | Content 알림 / navigation·toast | 7 / P2 | 중복·자기 알림·탈퇴 수신자 |
| M01 거래 종목 카탈로그 | M / PARTIAL | V1 Spot/Futures, V2 Futures12 DB·provider unit mapping | Futures 유지·Spot 승인 후 카탈로그 분리 / 하드코딩 금지 | 1,5 / P1 | 내부ID·provider변경·단위 |
| M02 실시간 시세·차트·호가 | M / V2_IMPROVEMENT | V1 Browser Binance, V2 중앙 수신·Redis·Browser WS·history cursor | V2 경로 유지; Last/Mark 혼용 금지 / 서버 WS 사용 | 전 단계 / P0 | stale·clock skew·1000계약·gap |
| M03 서버 가격·복구 | M,F / V2_IMPROVEMENT | DB cursor·Redis stream·replay·gate·bounded backoff | 금융 전환 때 그대로 재사용 / unavailable 표기 | 전 단계 / P0 | Redis 유실·재시작·중복 tick |
| X01 Funding/TP-SL/뉴스 | M / UNVERIFIED | 조사한 V1 업무 코드에 실제 기능 근거 없음 | V1 필수 복원 목록에 넣지 않음 / V2 신규 기획 별도 | 별도 | 근거 발견 시 목록 수정 |
| X02 일별 자산 스냅샷 | A / UNVERIFIED | PortfolioSnapshot Entity/Repository는 있으나 createSnapshot 호출·자정 배치 구현 근거 미발견 | 이름만으로 수익 곡선 기능을 완료로 판단하지 않음 / 별도 요구 확인 | 별도 | 생산 경로·실제 화면 확인 |

## 복제하지 않을 V1 문제와 의도적 차이

1. V1 `FuturesCurrentPriceService` 실제 코드는 **futures ticker cache**를 사용한다. 일부 설명서의 Mark 표기를 그대로 믿지 않는다. V2의 authoritative Mark와 freshness를 유지한다.
2. V1 격리 청산은 저장된 임계값을 체결가처럼 사용하고 음수 반환을 0으로 막는다. 이 방식을 V2의 실제 Mark 체결 이력으로 위장하지 않는다. 갭 손실의 원장 처리 결정은 [전환 계약](isolated-margin-cutover.md)의 승인 항목이다.
3. V1 수수료·가격·수량의 4/8자리 HALF_UP 및 UI Number 계산을 복사하지 않는다. V2 BigDecimal·exact basis·명시적 scale을 유지한다.
4. V1 MOCK 포기는 Holding을 물리 삭제한다. V2 업무 이력 보존 규칙에 맞게 상태와 종료 이력을 남겨야 한다.
5. V1 `PARTIALLY_FILLED`는 enum/조회에 있으나 실행 경로는 잔여 전량 체결이다. enum만으로 부분체결을 필수 기능이라고 만들지 않는다.
6. V1 trade history 화면은 `FuturesOrderList mode="trades"`다. V2의 Order/Fill/Position lifecycle을 구분한 API는 유지·보완할 수 있지만 Order 목록을 closed Position이라고 부르지 않는다.
7. V1의 실제 현물/선물 가격 종류 차이와 대회 종료 원장 집계(포지션 realized 합계 위주)는 수수료·이체·격리 gap까지 정합성 검증 후 이식해야 한다. 과거 버그까지 기능으로 복제하지 않는다.

## 후속 단계와 승인 경계

| 순서 | 독립 PR 단위 | 완료 게이트 |
|---|---|---|
| 0 | 이 조사표·API 근거·읽기 전용 원장 검사 | 코드/DB 조사, preflight PostgreSQL 테스트·기존 회귀 |
| 1 | 격리 금융 계약→엔진/영속 필드/전환 migration | gap·fee 정책 확정, 실제 legacy 상태 복제 migration 시험, 표시/청산 동일식·잠금/복구, Frontend 호환 배포 순서 |
| 2 | Market/Limit fee·주문 예상 비용·잔여 담보 정산 | 실제 원장 fee·100% 사이징·기존 멱등성·경합 |
| 3 | Fill/closed Position history→개인 거래 이벤트 | 필터·cursor·생애주기·인증/재전송 |
| 4 | **승인 후 Content 서버**·회원 JWT와 Trading 소유권 | 서비스/Secret/쿠키/Guest 연결 정책, root Compose/문서 범위 승인 |
| 5 | Spot/Mock/회원 지갑/이체 | Spot/Futures 원장 분리·금융 합계·재시도 |
| 6 | 대회 관리/계정·공유 engine→종료·랭킹 | ADMIN 권한·정산 재실행·타 계정 격리 |
| 7 | Content 커뮤니티/프로필/알림·운영 | V1 목록 전 항목 테스트, 서비스 경계·실제 Frontend 연동 |

이 표의 MISSING/PARTIAL/MISMATCH는 과거 조사 기록이다. 상단의 최신 V2 범위와 사용자 승인 항목만 구현 대상으로 삼고,
제외·보류 기능을 미완료 의무로 간주하지 않는다. 실제 구현과 검증 없이 전체 완료라고 보고하지 않는다.
사용자 실제 포지션 강제 정리와 Frontend 변경은 승인되지 않았다. 2026-10-21 사용자는 후속 Content 서비스와
필요한 루트 README/AGENTS/Compose/.env.example 수정 범위를 별도로 승인했다.

## Phase 1 진행 기록

`feature/trading/isolated-margin-parity`는 F06~F10 및 격리 담보 반환/예상가/레버리지 경로를 구현한다.
위험 기준은 Position 담보이며 표시와 Trigger가 같은 IsolatedMargin 계산을 사용한다. 실제 Mark gap의 gross PnL·청산 fee·shortfall adjustment를 보존한다.
V11은 기존 OPEN 노출을 PENDING으로 보존하고, 유효한 전체 기존 Mark와 각 Position 안전성 확인 후에만 담보 금액 그대로 전환한다.
이미 위험한 legacy는 REVIEW_REQUIRED로 영속 보류한다. 실제 사용자 DB에는 migration을 적용하지 않는다.
정확한 현재 API는 Runtime OpenAPI와 Trading README를 따른다. MARKET/LIMIT fee(F15)·이력(F18~20)·개인 이벤트(F22)는 여전히 후속 구현 대상이다.
검증 결과와 병합 여부는 각 PR에서 확인하며 이 진행 기록만으로 전체 이식 완료를 의미하지 않는다.

2026-10-20 Phase 1 검증: Java 17 `clean build` 및 마지막 검수 반영 후 `build` 성공.
PostgreSQL/Redis 통합 검증을 포함한 전체476개 테스트 통과(실패·오류·건너뜀0).
V11 legacy 보존/반복 적용/불일치 rollback, 격리 임계값·실제 gap 정산·보류 상태,
개별 청산·반대편 보존·동시성·기존 Redis 복구와 API 인증 회귀를 확인했다.
실제 사용자 DB migration과 Frontend 호환 배포는 실행하지 않았다.

## Phase 2 진행 기록

`feature/trading/futures-fees-and-order-quotes`: F15 수수료와 F23 새 OPEN 최소10 USDT를 복원한다.
MARKET0.05%/LIMIT0.03%는 실제 Mark 체결 금액에 CEILING18로 부과하며 gross PnL과 구분한다.
Pending OPEN은 담보+fee 예약, 취소/거절 시 전부 해제한다. leverage 변경은 fee를 다시 부과하지 않는다.
V12는 기존 fee-free 접수 정책을0%로 보존하고 과거 금융 값을 바꾸지 않는다.
서버 OPEN quote API가 비용·비율 수량을 계산하여 Frontend의100% 주문 수량 계산 복제를 대체한다.
이력(F18~20), 개인 이벤트(F22), 회원/Spot/대회/Content 등은 여전히 후속 단계이며 전체 이식 완료가 아니다.

2026-10-21 Phase 2 검증: Java17 `clean build` 성공, 전체499개 테스트 통과(실패·오류·건너뜀0).
고정 수수료 금액·OPEN/CLOSE·지정가 실제 Mark·취소/거절·레버리지·비율10/25/50/100%·추가 진입·소액 잔여 종료,
기존 수수료0% 소액 계약 실행과 V12 반복/이력 보존을 검증했다. 기존 재무 경합/rollback/replay 검증도 유지한다.
실제 사용자 DB에 V11/V12를 적용하거나 Frontend를 배포하지 않았다.

## Phase 3 진행 기록

`feature/trading/trade-history-and-events`: F18~F20의 주문 필터·Fill·종료 Position 생애주기 이력과 F22의 개인 거래 이벤트 계약을 제공한다.
Fill은 부분청산·강제청산·수수료·조정액 및 원래 Position ID를 보존한다. 종료 이력은 합산 전 donor 체결까지 연결하여
생애주기 gross PnL·fee·adjustment·net을 반환한다. OPEN/MERGED를 종료 이력으로 위장하지 않는다.
필터·상한 있는 keyset pagination·계정 인증을 적용하며 시장 데이터 장애 중에도 이력을 읽을 수 있다.

V13의 영속 이벤트 스냅샷은 금융 변경과 같은 Transaction에 기록한다. 실패하면 금융 변경도 rollback하며
커밋 전/rollback 이벤트를 전송하지 않는다. `/ws/trading`은 첫 프레임 Guest 인증 후 본인 이벤트만 보내고
만료 시 종료한다. REST 재조회와 재접속 cursor로 누락을 복구하며 eventId 중복 제거는 클라이언트 계약이다.
기존 공개 `/ws/market` 및 요청 응답 토스트 계약은 유지한다. V13 이전 알림을 가짜로 소급 생성하지 않는다.
알림 센터 읽음/숨김·Content/이체/대회 알림은 후속 단계다. 신규 외부 의존성은 없다.

2026-10-21 최종 구현 전체 `build` 성공, 전체515개 테스트 통과(실패·오류·건너뜀0).
이후 추가한 Runtime OpenAPI 검증을 포함한 이력 통합 테스트9개도 별도 실행하여 모두 통과했다.
이전 `clean build`는514개 테스트를 통과했다. 실제 사용자 DB/Frontend는 변경하지 않았다.

## Phase 4 인증 계약 결정

2026-10-21 사용자가 설계 검토 후 다음 계약을 승인했다. 외부 로그인은 Google·Kakao만 지원하고
Content가 회원·자체 JWT 발급을 소유한다. Trading은 공개키 검증 후 memberId로 자신의 계정을 찾는다.
공급자 ID로 회원을 식별하고 이메일 자동 연결 및 Guest 금융 이력 자동 병합은 하지 않는다.
OAuth state와 짧은 임시 세션을 사용하고 인증 토큰을 URL에 넣지 않는다.
Access JWT15분은 JSON 응답/Frontend 메모리, Refresh7일은 HttpOnly·운영 Secure 쿠키로 관리하며
DB에는 해시만 저장하고 사용 시 회전한다. 갱신·로그아웃은 CSRF 검증을 적용한다.
로그아웃은 Refresh를 폐기하며 기존 Access는 최대15분 유효할 수 있다. Frontend 구현은 승인 범위에 포함되지 않는다.

## Phase 4 회원 인증 기반 구현

Content 인증 기반은 `feature/content/oauth-member-auth`, PR26으로 develop에 병합했다.
Google OIDC/Kakao OAuth2만 등록하며 provider ID·약관/개인정보 동의·닉네임 가입과 본인 프로필 읽기를 제공한다.
RS256 Access15분·Refresh 고정7일·해시 저장·회전·재사용 family 폐기·CSRF를 구현했다.
공개 JWKS에는 개인키가 없고 OAuth 임시 세션으로 업무 API를 인증하지 않는다.
2026-10-21 Content `clean build` 및 최종 `build` 성공,20개 테스트 통과(실패·오류·건너뜀0).
실제 OAuth 네트워크/운영 Secret은 사용하지 않았다.

`feature/trading/member-jwt-accounts`는 회원 JWT의 공개키 검증과 명시적 본인 선물 계정 생성을 연결한다.
V14의 member_id는 Content 테이블을 읽거나 FK로 연결하지 않는 scalar ID다.
동시 최초 생성은 PostgreSQL Transaction 잠금과 Unique로 하나만 생성하며 Wallet도 같은 Transaction에 저장한다.
회원 선물은 V1 배분에 맞춰0 USDT로 시작하며 기존 Guest10000 계정·원장은 자동 연결하거나 변경하지 않는다.
인증/GET에는 생성·충전 부작용이 없다. 본인 계정 미생성은409로 구분한다.
기존 private REST/WS는 검증한 소유권으로 범위를 제한하며 JWT 만료 시 WS를 종료한다.
현재 Trading의 로컬 단일 설정에 prod Profile을 추가하여 Swagger 차단·별도 migration 계정·HTTPS issuer/명시적 Origin을 요구한다.

2026-10-22 Trading `clean build` 성공, 전체525개 테스트 통과(실패·오류·건너뜀0).
JWT 위조·공급자 issuer·잘못된 audience/token_use·만료·Guest 역할 거부, 인증/GET 무생성,
반복·동시 회원 계정 생성, Guest/다른 회원 원장 격리, 실제 개인 WS JWT 인증·만료,
V14 기존 Credential/Wallet 보존·반복 migration과 기존 금융/복구 회귀를 확인했다.
JWT 검증을 실제 활성화한 prod Profile 기동·공개키 로딩·Swagger 차단 테스트도 별도 재실행하여 통과했다.

U01~U03 중 OAuth/가입/토큰 기반과 U04 본인 프로필 읽기, 회원 소유권 경계는 구현했지만 Phase4 전체 완료는 아니다.
Guest 최종 JWT 전환, 이미지·팔로우/관심 종목, 지갑 이체·성과·공개 포트폴리오는 후속 작업이다.
Spot/Mock·대회/랭킹·커뮤니티/알림 센터 역시 조사표의 미구현 항목으로 남는다.
사용자 DB와 Frontend는 변경하지 않았다.

## Phase 4 기본 프로필·탈퇴

PR28로 공개 ACTIVE 프로필, 본인 닉네임/메시지 부분 변경, 닉네임 사전 확인을 추가했다.
Content27개 테스트와 clean build를 통과했으며 이미지·팔로우 등 미구현 정보를 가짜 필드로 채우지 않는다.

2026-10-22 사용자 승인 탈퇴 정책: 정상 시세를 기다리는 매매 청산이 아니라 탈퇴 전용 종료다.
Content 회원 소프트 삭제/Refresh 전부 폐기와 영속 요청 저장을 하나의 Transaction으로 처리한다.
Trading은 서명된 전용60초 JWT 요청만 받아 동일 계정 잠금 안에서 PENDING 취소, CLOSE 예약 해제,
OPEN 포지션 CLOSED/MEMBER_WITHDRAWAL 처리, Wallet 증거금 해제, 계정 WITHDRAWN을 원자적으로 수행한다.
가격/Fill/추가 손익/수수료를 만들지 않고 기존 체결·부분 실현 손익·잔액·이력을 보존한다.
일반 매매 종료 조회에서 탈퇴 종료를 제외한다. 가격 장애·격리 검토 보류는 이 행정 종료를 막지 않는다.
Content V2/Trading V15 migration으로 요청 전달 상태와 종료 사유를 관리하며 기존 migration은 수정하지 않는다.
명시적 HTTP와 영속 재전송을 사용하고 상대 서비스 DB를 읽거나 수정하지 않는다.
중복·재시작·204 유실은 멱등 처리하며, 원장 불일치는 전체 rollback 후 요청이 대기 상태로 남는다.
Content 접수202와 Trading 완료를 구분한다. 전송 전에는 기존 Trading Access가 만료 전까지 사용될 수 있다.
실제 사용자 DB/Volume·Frontend·커뮤니티 데이터는 변경하지 않았다. 전체 V1 이식 완료가 아니다.

2026-10-22 Content clean build 및 최종 build30개, Trading clean build 및 최종 build529개 테스트 통과
(각 실패·오류·건너뜀0). 가격 없이 모든 주문 취소/포지션 종료, 기존 부분 실현 손익·수수료 보존,
탈퇴 전용 서명/대상 격리, 무계정 tombstone·재생성 차단, 동시 주문 경합, 원장 불일치 rollback,
격리 검토 보류 계정 종료와 Content 영속 재시도/전송 재개를 확인했다.

## Phase 4 팔로우

V1 FollowController/FollowService/MemberFollowRepositoryImpl/FollowFacadeService를 읽기 전용 조사했다.
Content에 PUT/DELETE 팔로우, 공개 followers/followings 커서·검색, 관계/집계 조회를 추가했다.
V1의 관계 ID 내림차순/기본·최대10개 조회는 유지한다. 잘못된 size/cursor는 V2에서400으로 명시한다.
언팔로우는 V1의 물리 삭제 대신 비활성화하며 재팔로우는 새로운 관계 ID를 만들고 과거 행은 보존한다.
회원 행 오름차순 잠금·활성 관계 부분 Unique로 중복 요청을 직렬화하며 집계는 활성 관계에서 직접 계산한다.
탈퇴와 양방향 관계 해제는 동일 Content Transaction이다. Trading DB·Frontend는 수정하지 않는다.
Content V3 migration, 기존 JdbcTemplate DTO Projection만 사용하며 추가 의존성이 없다.
Content clean build38개 테스트 통과(실패·오류·건너뜀0). 이미지/bestCount는 가짜 필드를 추가하지 않는다.
V1 follow 알림 저장/SSE는 아직 미이식이며 Content 알림 단계에서 실제 기능으로 연결해야 한다.

## V2 Guest 재도전 API

사용자가 범위를 재도전 API까지만으로 제한했다. `POST /api/v1/trading/account/retry`는 기존 Guest
Bearer와 요청 키로 본인 계정의 현금을10000 USDT로 초기화한다. 대기 주문 취소·포지션 행정 종료·예약 해제와
V16 guest_retry 기록을 같은 계정 잠금/Transaction으로 처리한다. 과거 금융 이력·누적 Fill 손익/수수료·토큰/만료·ID를 보존한다.
같은 키는 원래 응답을 반환할 뿐 새 거래나 잔액을 다시 초기화하지 않는다. 회원은403, 만료 Guest는401이다.
초기화 차액은 매매 손익이 아닌 별도 자금 조정 기록으로 남긴다. 재도전 이력은 미사용 Guest 정리에서 보호한다.
2026-10-22 clean build 전체539개 테스트 통과(실패·오류·건너뜀0). Frontend·Content·실제 사용자 DB는 변경하지 않았다.
투자 성과·회원 자금 확장·이메일 추가 인증·퀘스트 등 다른 기능은 이 작업에서 시작하지 않았다.
