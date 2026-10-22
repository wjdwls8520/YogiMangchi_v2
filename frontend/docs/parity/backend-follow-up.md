# Backend 계약 준비 상태 및 후속 작업

수정 소유권: 이 Work는 frontend/**만 수정한다. 아래의 B 항목은 요청할 계약 초안이며, 실제 존재하는 API나 확정된 제품 계약으로 취급하지 않는다. 금융 결과는 항상 서버가 확정한다.

## 준비된 계약 — Frontend 연결 대상

| ID | 현재 계약 | Frontend 의존성 / 확인할 상태 |
|---|---|---|
| T1 | Trading Runtime 확인: GET account/summary, wallet, positions; GET/PUT account/symbols/{id}/leverage; POST account/orders/quote, orders, positions/{id}/close, close-orders; POST orders/{id}/cancel | ISOLATED/LEGACY_CROSS 및 transition COMPLETE/PENDING/REVIEW_REQUIRED. Position liquidationPrice/status/asOf, openedMarginMode. quote는 quantity 또는 balancePercentage 하나만, 현재 서버 leverage·fresh Mark 기준. Order feeRate/reservedFee, Fill gross/fee/settlementAdjustment. 기존 error/status/idempotency 유지. |
| T2 | GET account/orders(beforeId/limit/symbol/side/action/status/type), fills(beforeId/limit/symbol/side/action/type/executedFrom/executedBefore), positions/history(cursor/limit/symbol/side/status/closedFrom/closedBefore) | orders/fills는 배열·마지막 ID cursor, closed는 items/nextCursor 계약이며 hasNext 필드는 없음. opaque cursor 가공 금지. order/fill/lifecycle를 따로 표시. gross·fee·adjustment·net 구분. |
| T3 | GET account/events(afterId/limit), /ws/trading authenticated first frame; 공개 /ws/market은 별도 | 영속 eventId 순서·재연결/중복 제거·account ownership, 초기 replay의 과거 이벤트 토스트 억제. WS 인증/만료·resume 프레임 계약을 실제 서버와 확인. 쿠키 EventSource나 URL Bearer로 대체하지 않음. |
| T4 | POST account/retry, Guest Bearer + Idempotency-Key, body 없음 | 동일 account/credential/expiry/leverage 유지. pending 취소·open lifecycle reset 종료·cash10000, priced Fill/새 PnL/fee 없음, 기존 과거 이력 보존. 같은 key는 원래 reset snapshot 반환. 400/401/403/409 처리·불확실 응답에 새 key 자동 재전송 금지. |
| T5 | Content 소스 존재: OAuth Google/Kakao; auth/csrf, flow, signup, login/complete, refresh, logout; members/me, public profile, profile update, withdrawal; follow/followers/followings; Trading accounts/member | Content8080 Runtime/실제 OAuth 설정 확인 대기. Access 메모리15분, refresh 쿠키 고정7일·회전·CSRF·single-flight. Guest credential과 분리, 자동 계정 연결/금융 병합 금지. 이미지 업로드·소개 등 허용 필드는 실제 DTO 범위만. 탈퇴 PENDING→COMPLETED, 권한과 개인정보 범위 확인. |

모든 경로는 서비스의 `/api/v1` 또는 `/api/v1/trading` prefix 아래 실제 Runtime 문서를 따른다. T1~T4는2026-10-22 실행 중인8081에서 확인했다. T5는 소스 기반이며 Runtime 연결 완료 표시가 아니다.

## 부족한 계약 — BACKEND FOLLOW-UP

| ID | 필요한 기능 / V1 근거 | V2 현재 상태 | 제안 Request → Response 및 Frontend 의존성 | 미구현 시 사용자 영향 |
|---|---|---|---|---|
| B1 | 최근 시장 체결, `web/components/trade/RecentTrades.tsx` | market candle/ticker/depth는 있으나 recent trades REST/stream 없음 | symbolId+limit → tradeId/decimal price/quantity/time/side/status; WS 동일 ID·종목·중복/재연결 규칙. Binance→서버→Frontend 경로 필요 | Recent Trades 화면 복원 불가; Binance 직접 연결로 우회하지 않음 |
| B2 | 관심 종목, `web/lib/api/favorite.ts`, CoinList/useFavoriteStore | 회원 favorites endpoint 없음 | 인증 GET 목록, 종목 ID PUT/DELETE 멱등 변경 → 사용자 소유 ID 목록; Guest 지원 여부 별도 확정 | 계정 간 관심 목록 복구·동기화 불가 |
| B3 | Spot BUY/SELL·보유 코인·미체결·취소·이력, `web/lib/api/trade.ts`, `was/.../spot/controller/v1/*SpotOrderController.java` | 선물 계정만 존재 | 서버 symbol/quantity/quote/notional/fee·예약 현금/코인·idempotency·잔고/Fill/order cursor 계약 필요. 가격은 서버 Mark/Spot 정책 구분 | V1 현물 및 MOCK Spot 흐름 복원 불가 |
| B4 | 지갑 선택·이체·가능액·이력, `web/components/asset/AssetTransferModal.tsx`, `was/.../real/controller/v1/AssetTransferController.java` | 추가 지갑·이체 API 없음 | fromWalletId/toWalletId/decimal amount+key → 서버 transferId/status/balances; transferable·cursor history·실패 원자성·소유권 규칙. Guest 재도전과 별개 | 자산 이동 및 지갑별 자산 화면 미구현 |
| B5 | 프로필 이미지/게시글 이미지 업로드, V1 multipart profile/post | Content profile JSON 범위만 존재 | 허용 파일종류/크기·upload 권한·저장 URL/ID·삭제/보존·XSS/외부 URL 정책을 명시. 기존 update DTO만으로 파일 업로드를 지원한다고 표시하지 않음 | 첨부·avatar 업로드 사용 불가 |
| B6 | 투자 성과·공개 포트폴리오, `web/lib/api/portfolio.ts` | 미구현, 사용자 승인 후순위 | 기간/계정 → cashflow-adjusted 수익률·평가 시각·gross/net·공개 범위. 서버 원본/시계열 계약 필요 | 후순위로 추적; 로컬 가짜 수익률 제공 금지 |
| B7 | 대회 목록/상세/참가/대회 Wallet/거래/랭킹/결과/내역, V1 contest API와 contest-futures API | 대회 domain/API 없음 | season ID·공개/모집/진행/종료·application/participant 상태·전용 account ID·정산·ranking cursor·회원/Guest 자격. admin 변경과 권한 별도 | 대회 사용자·관리자 전체 흐름 복원 불가 |
| B8 | 게시글 카테고리/검색/상세/CRUD, 댓글/대댓글/좋아요/활동/새글 이벤트, `web/lib/api/post.ts`, me-community, community-ux | Content auth/member/follow만 존재 | post/reply ID·category·body/media·cursor/filter·author/visibility·soft-delete·멱등 like·공개 feed 이벤트. 서버 권한/HTML sanitization 명시 | 커뮤니티 작성·조회·활동·홈 피드 복원 불가 |
| B9 | 신고·취소·사유·내 신고 목록, `web/lib/api/post.ts`, `was/.../report/controller/v1/*` | 신고 API 없음 | 대상 type/id+reason enum → report/status, own cursor 목록/취소; 중복/삭제 대상/비공개 규칙 | 신고 및 사용자 신고 관리 불가 |
| B10 | 알림 센터·미읽음·읽음·개별/일괄삭제·Content 실시간 이벤트, `web/lib/api/notifications.ts` | Trading 영속 events는 존재하나 알림 CRUD/Content feed 없음 | domain+notificationId+cursor/filter → type/target/createdAt/readAt/visibility; 읽음/삭제 소유권·복구/보존·스트림 resume 규칙. Trading/Content DB 경계 유지 | 주문 토스트/Trading events만 가능; 통합 알림센터 불가 |
| B11 | 관리자 회원/게시글/댓글/대회 검색·수정·탈퇴·삭제·정산, V1 admin routes/API | 본인 탈퇴 외 admin API 없음 | 역할 기반 admin endpoint·검색/cursor·명시 확인·감사/보존·Trading 정리 결과 계약. 일반 사용자 권한으로 우회 금지 | 관리자 실제 관리 기능 복원 불가 |
| B12 | 전체 회원/팔로워 랭킹, V1 rank page | V1도 일부 게시글 작성자 탐색 정렬, V2 ranking API 없음 | 공개 대상 모수·정렬/동률·기간·cursor·role/status·snapshot 시각 정의 후 서버 집계 | 일부 사용자를 전체 랭킹으로 오인시키는 UI 금지 |

## Backend 변경 요청 순서

Trading T1~T4 소비 → Content T5 Runtime 및 OAuth 준비 → 실제 제품 우선순위로 B 항목 개발. B 기능을 미리 가짜 화면으로 완료 처리하지 않는다. 이메일 인증/해금 퀘스트는 현재 정책상 제외하므로 Backend 개발 요청에 넣지 않는다. 후순위 B6는 삭제하지 않는다.
