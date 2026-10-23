# V1 사용자 행동 기반 검증 계획

현재 문서는 실행 계획이다. 체크를 채우기 전 자동/실제 테스트 통과로 보고하지 않는다. 현재 단계별 결과는 아래 표에 실제 증거와 함께 기록한다.

## 선물 / Guest (T1~T4)

- [ ] 새 Guest 명시 시작→10000USDT→새로고침 같은 account ID/7일 expiry 복구. 만료/401 자동 생성 없음.
- [ ] BTC10배 LONG 첫 진입·추가 진입→한 position ID·합산 수량·서버 가중평균 진입가. SHORT 두 번 진입→별도 한 행, LONG 불변.
- [ ] ISOLATED 양방향 collateral·서버 liquidationPrice/status/asOf. PRICE_UNAVAILABLE/NO_THRESHOLD/UNSUPPORTED_MODEL/ALREADY_AT_RISK/legacy hold에서 가짜 가격 없음.
- [ ] 10→14→100배 변경·Margin/Wallet/ROE 갱신·ETH 독립·101거절·변경 실패 이전 서버값 유지.
- [ ] 1/37/99/100% 및25/50/75/100 빠른값. 수수료 포함 서버 sizing. LIMIT 가격 미입력 비율 허용/수량0. 유효 가격 입력 뒤 다음 비율 선택 때 계산. 가격 변화 시 기존 Quantity 불변.
- [ ] 시장가/지정가 OPEN, passive-price 제한, quote 만료/시세 부족/증거금 부족/최소 주문 제한. 새로운 key 자동 재전송 없음.
- [ ] LIMIT 예약→트리거 체결→실제 fee·예약 해제→Fill/이벤트. 체결/취소 경합.
- [ ] 25%·50% MARKET partial, LIMIT partial/full 예약·취소, 예약 중 추가진입, free 수량 초과 금지, MARKET full. 정확한 side/position ID.
- [ ] 한쪽 liquidation 이후 반대 포지션·다른 종목 담보 보호. 실제 유도 어려우면 계약/격리 테스트만 수행하고 실제 성공이라고 보고하지 않음.
- [ ] 주문 건수와 Fill 건수와 종료 lifecycle 건수를 각각 조회. 추가진입3·partial2·full1을 한 종료 lifecycle로 표시; 초기 Margin/마지막 exitPrice 의미 오인 없음.
- [ ] cursor 2페이지 이상·동일ID/순서·필터/기간 변경 시 초기화·실패 재개·오래된 계정 응답 버림.
- [ ] 이벤트 WS 최초 인증→afterId 재연결→단절중 체결 재생·중복 제거. 초기 과거 알림 폭주 없음. URL/로그/오류에 Bearer 없음.
- [ ] Guest 재도전 명시 확인: 기존 주문 취소/포지션 reset 종료·10000복구·같은ID/credential/expiry·레버리지선호 유지·과거 ledger/Fill 보존. 새 priced Fill/PnL 생성 없음.
- [ ] 재도전 double-click·timeout/503 후 같은 key 결과 확인·다른 deliberate retry에만 새 key. 이전 재도전 replay가 새로 자금을 reset하지 않음.
- [ ] 재도전 전의 미확인 주문/청산 intent·진행중 조회·WS/이벤트 snapshot이 reset 후 부활하지 않음. 세션/epoch 경계 검증.
- [ ] 차트·Header·폼 동일 Mark, historical+WS candles overlap, 종목/주기 전환·호가 클릭 입력만·토스트1.5초/누적/X/모달/키보드.
- [ ] 320/390/768/1024/1440/1920 각각 주문·레버리지·부분/전체 청산·목록·알림 접근, 페이지 가로 넘침/스크롤/focus 확인.

## 회원 / 자산 (T5 및 B 계약 준비 후)

- [ ] Google/Kakao 기존회원 로그인/new회원 signup·닉네임/동의→메모리 Access. Redirect URL에 token 없음. CSRF·HttpOnly Refresh 회전·동시 갱신 single-flight·실패 세션 종료.
- [ ] Guest→Member→logout 전환 시 credential/query/event/form/financial account 혼합 없음; 금융 이력 자동 병합 없음.
- [ ] 내 profile 조회·허용 필드 변경·중복 nickname·탈퇴자/public profile·타인 비공개정보 차단.
- [ ] follow/unfollow·self-follow 거절·followers/followings cursor·동시토글·탈퇴 사용자.
- [ ] 회원 탈퇴 PENDING→COMPLETED·Trading 정리 상태·Refresh 폐기·기존Access 최대15분 계약 안내. Guest 이력은 별개.
- [ ] 지갑 선택·이체 가능액·동시이체/idempotency·실패 원자성·이체 이력. Backend 준비 전 실행 미완료.
- [ ] 성과/공개 포트폴리오는 후순위·공개범위/현금흐름/기간/정산 기준 확인 후 실행.

## 현물 / 대회 / 커뮤니티 / 알림 (각 B 계약 준비 후)

- [ ] Spot BUY/SELL MARKET/LIMIT·보유 코인/현금 예약·취소·체결·이력·수수료·계정 분리.
- [ ] 공개 대회 목록→상세→신청→승인/거절→전용 Trading→랭킹→정산 결과→개인 참가 이력. Guest/일반/대회 계정 혼합 없음.
- [ ] 관리자 대회 생성/상태/참가자 심사/정산·역할403·중복 정산 방지·공개범위.
- [ ] 게시글 카테고리/검색/페이지→상세→작성/이미지/수정/삭제→댓글/대댓글→좋아요/신고/취소→프로필 활동.
- [ ] 내 글/댓글만 수정·삭제글/탈퇴자·부모댓글삭제·XSS·업로드 실패·실시간 새글 배너.
- [ ] 알림 안읽음/개별·일괄읽음/삭제/cursor/대상 이동·재연결/중복·logout 중 수신·타인 알림 차단.
- [ ] 관리자 글/댓글/회원 검색·상세·삭제·탈퇴·보존·감사·일반회원 권한 거절.

## 실행 결과 기록

| 단계 | 자동 테스트 | lint/typecheck/build | 실제 서버 / 브라우저 | 미검증·차단 |
|---|---|---|---|---|
| 0 전수조사 | 소스 경로·정적 연결·CSV 구조 점검 / 기존 테스트166개 통과(고아 test output 제거 후) | lint/typecheck/webpack build 통과 | V1 main 버전·Trading8081 OpenAPI 확인 | V1 실제 서버 미실행, Content8080 Runtime 대기, 사용자 시나리오 실행 전 |
| 1 Trading 계약 복원 / PR34 | 177개 통과 | 모두 통과 | Guest20 MARKET OPEN/CLOSE·100배·강제청산가·100% 서버 견적·LIMIT 예약/취소·사용자 승인 재도전10000/동일ID/이력보존 | SHORT/다중 lifecycle 복합 시나리오·실제 강제청산 유도 미실행 |
| 2 이력 및 개인 이벤트 | parser·100건 Fill 경계·재연결/중복/계정전환/heartbeat/오류 횟수·안전한 알림 테스트 추가 | 최종 검증 결과는 PR에 기록 | 실제 Fill/종료 포지션·CLOSE 필터·개인 WS 실시간·주문98 접수/취소 타 화면 갱신·6개 너비 확인 | 실제100건/비동기 LIMIT fill/강제청산 유도 미실행; 해당 복구 로직은 격리 검증 |
