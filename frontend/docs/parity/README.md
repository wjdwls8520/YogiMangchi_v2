# V1 → V2 사용자 기능 복원 추적

## 사용자 의도 및 적용 정책

V1 사용자가 이용하던 기능과 경험을 V2의 기술 구조에서 재현한다. V1 코드·디자인·금융 정산·직접 Binance 통신을 복제하지 않는다. 전체 범위는 후순위라는 이유로 삭제하지 않는다.

2026-10-22 사용자 재확인: Guest 우선, 이메일 추가 인증·거래 해금 퀘스트 제외, 투자 성과·공개 포트폴리오 후순위. 최종 금융 정책은 Hedge + Isolated Only + 100배다. 회원 Access는 메모리15분, Refresh는 HttpOnly 쿠키 고정7일·CSRF·회전 계약을 따른다. Guest와 회원 금융 이력을 자동 병합하지 않는다.

## 근거와 상태

- V1 main: `a3391b523356d0f44cfec21cb302e326f52b6db3`. 원격 main과 로컬 main 일치 및 V1 작업 트리 변경 없음 확인. V1은 읽기 전용이다.
- V2 분석 기준: `origin/develop c614f5d`. 선행 PR #23(Isolated), #24(수수료/견적), #25(거래 이력/개인 이벤트), #26~30(회원/탈퇴/프로필/팔로우), #32(Guest 재도전) 확인.
- Trading `http://localhost:8081/v3/api-docs` 실행 계약 확인(2026-10-22). Isolated/견적/Fill/종료 포지션/이벤트/Guest 재도전이 존재한다.
- Content 8080은 실행 확인 대기. Controller/DTO는 읽었으나 실제 OAuth·쿠키·CSRF 동작 검증 완료로 간주하지 않는다.
- V1 서버를 실행하지 않았다. 소스 호출 근거와 실제 서비스 실행 검증은 구분한다. 파일 존재·import만으로 PARITY를 선언하지 않는다.

## 전체 기능 추적 자료

- [기능 비교표 CSV](feature-matrix.csv): 사용자 행동74개. V1 경로·API, V2 화면, 차이, Frontend 구현, Backend 의존성, 테스트 시나리오를 기록한다.
- [V1 소스 인벤토리](v1-source-inventory.md): TS/TSX202개, 페이지27개, API export130개(별도 파일 호출 근거121개), 페이지/API 연결·직접 통신·Backend Controller 매핑 색인.
- [Backend 계약 및 후속 작업](backend-follow-up.md): 준비된 계약 T1~T5와 부족한 계약 B1~B12를 구분한다.
- [사용자 시나리오](user-scenarios.md): 실제 실행 결과를 기록할 검증 기준. 시나리오가 있다는 사실을 테스트 통과로 해석하지 않는다.

초기 분류: PARTIAL15 / BEHAVIOR_MISMATCH4 / MISSING16 / V2_IMPROVEMENT7 / BACKEND_BLOCKED29 / UNVERIFIED3. 기존 기능도 최신 Isolated 서버에서 재검증하기 전 PARITY로 올리지 않았다.

분류 축은 분리한다. `구현 상태`는 기존/부분/필요/미확인, `Backend API 상태`는 준비됨/미구현/실행 확인 대기, `정책·우선순위`는 현재 제외/후순위/Guest 우선을 나타낸다. 정책상 제외를 누락이나 Backend 장애로 오인하지 않는다.

## 확인된 중요한 차이

1. 현재 Frontend 레버리지 parser는 `CROSS`만 수락한다. 최신 Runtime은 `ISOLATED` 또는 `LEGACY_CROSS`와 `marginTransitionStatus`를 반환하므로 주문 UI 연동을 우선 수정해야 한다. 임의 Cross 계산이나 mode 선택 UI를 추가하지 않는다.
2. Frontend는 서버의 `liquidationPrice/status/asOf`, 수수료, 서버 견적을 아직 소비하지 않는다. 100% 자산 비율에 OPEN 수수료를 포함하려면 서버 견적을 사용해야 한다. LIMIT 가격 미입력 시 비율 허용·수량0은 유지한다.
3. Backend Fill/종료 Position API는 이미 준비됐다. Frontend의 최근50건 고정 주문 목록과 준비 중 종료 Position 화면은 미완성이다. 세 이력을 서로 변환하거나 합치지 않는다.
4. V1 TradeHistoryTab은 완료 주문을 재사용했다. V2에서는 실제 Fill API를 연결하는 개선이 필요하다. V1의 필터는 status/type/side와 cursor 경로별 실제 구현을 확인하며, 서버 필터 존재만으로 날짜 UI가 구현됐다고 주장하지 않는다.
5. 주문 결과 토스트는 로컬 커밋 `70dfa44`에 있지만 최신 develop에 미포함이다. 해당 검증 구현을 재사용해 복원하고 중복 작성하지 않는다.
6. V1 최근 시장 체결은 Frontend→Binance 직접 호출이다. V2 서버에 해당 계약이 없으므로 같은 방식으로 이식하지 않는다.
7. V1 follower 순위는 게시글에서 발견한 일부 작성자를 모아 정렬한다. 이를 전체 회원 랭킹으로 복제하지 않는다. 뉴스·개발 샘플·정적 어드민 메인은 실제 완성 서비스 기능과 구분한다.
8. Guest 재도전은 새 Guest 발급이나 V1 회원 MOCK 참여/포기로 대체하지 않는다. 최신 API는 동일 계정·credential을 유지하며10000 USDT로 복구한다.

## 단계별 진행 및 완료 판정

0. 이 전수조사/비교표를 별도 분석 PR로 저장한다.
1. 새 브랜치에서 준비된 Trading Runtime 기반 Isolated·강제청산가·견적/수수료·기존 토스트 복원·Guest 재도전을 구현한다. 기존 화면 구조와 입력 UX를 유지한다.
2. 새 브랜치에서 주문 cursor/필터·Fill·종료 Position·개인 이벤트를 연결한다.
3. Content Runtime과 OAuth 환경 확인 후 회원 UI/세션 격리·프로필·탈퇴·팔로우를 연결한다. Guest를 먼저 안정화한다.
4. Spot/이체/대회/커뮤니티/알림 CRUD 등 Backend 미구현 기능은 B 항목 계약 준비 후 단계별 구현한다. 전수조사 목록에서 삭제하지 않는다.
5. 투자 성과·공개 포트폴리오는 후순위로 유지한다. 이메일 인증/해금 퀘스트는 현재 정책상 구현하지 않는다.

각 기능은 비교표→Runtime 계약→Markup→Design→Functionality→자동 테스트/실제 사용자 시나리오→PR/develop 순서로 완료한다. 프론트엔드가 없는 API를 대신 정산하거나 가짜 체결/지갑/이력을 만들지 않는다. Backend가 없는 전체 프로젝트를 완료했다고 보고하지 않는다.
