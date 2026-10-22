# V1 main 소스 인벤토리

기준: `a3391b523356d0f44cfec21cb302e326f52b6db3` (원격 main과 로컬 main 일치, 작업 트리 변경 없음). V1은 읽기 전용으로 조사했다.

정적 import 도달성/함수 호출 위치를 기록한다. import나 함수 호출 발견은 실행 성공의 증거가 아니다. V1 서버를 실행하지 않았으므로 실제 응답/권한/동시성/반응형 실행 결과는 UNVERIFIED다.

## 모든 페이지와 실제 연결 API 모듈

| V1 페이지 | 직접 연결한 내부 모듈 | 도달 가능한 API 모듈 |
|---|---|---|
| `web/app/(admin)/admin/community/page.tsx` | `components/ui/Button.tsx`, `components/ui/FeedbackProvider.tsx`, `components/ui/Input.tsx`, `lib/api/admin-community.ts`, `app/(admin)/admin/community/components/PostDetailModal.tsx`, `app/(admin)/admin/community/components/ReplyDetailModal.tsx`, `app/(admin)/admin/components/CustomSelect.tsx` | `lib/api/admin-community.ts` |
| `web/app/(admin)/admin/contest/[seasonId]/page.tsx` | `components/ui/Button.tsx`, `components/ui/FeedbackProvider.tsx`, `lib/api/contest.ts`, `lib/api/admin-contest.ts`, `app/(admin)/admin/contest/components/ContestMembersManager.tsx`, `app/(admin)/admin/contest/components/ContestEditModal.tsx`, `lib/utils/adminFeedback.ts` | `lib/api/admin-contest.ts`, `lib/api/contest.ts` |
| `web/app/(admin)/admin/contest/page.tsx` | `components/ui/Button.tsx`, `components/ui/FeedbackProvider.tsx`, `lib/api/contest.ts`, `lib/api/admin-contest.ts`, `app/(admin)/admin/contest/components/ContestCreateModal.tsx`, `app/(admin)/admin/contest/components/ContestEditModal.tsx`, `lib/utils/adminFeedback.ts` | `lib/api/admin-contest.ts`, `lib/api/contest.ts` |
| `web/app/(admin)/admin/page.tsx` |  | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(admin)/admin/users/page.tsx` | `components/ui/Button.tsx`, `components/ui/FeedbackProvider.tsx`, `components/ui/Input.tsx`, `lib/api/admin-member.ts`, `app/(admin)/admin/users/components/UserDetailModal.tsx`, `app/(admin)/admin/components/CustomSelect.tsx` | `lib/api/admin-member.ts` |
| `web/app/(default)/assets/page.tsx` | `components/ui/FolderTabs.tsx`, `components/ui/Tabs.tsx`, `components/ui/Select.tsx`, `lib/utils/cs.ts`, `components/asset/AssetSummaryCard.tsx`, `components/trade/TickerCell.tsx`, `hooks/useBinanceWebSocket.ts`, `stores/useTickerStore.ts`, `stores/useMarketStore.ts`, `lib/utils/date.ts`, `lib/utils/market-display.ts`, `lib/utils/notification-sse.ts`, `lib/utils/number.ts`, `lib/utils/futures-position.ts`, `lib/api/asset.ts`, `lib/api/client.ts`, `lib/api/contest.ts`, `lib/api/contest-futures.ts`, `lib/api/trade.ts`, `lib/api/futures.ts`, `types/futures.ts` | `lib/api/asset.ts`, `lib/api/contest-futures.ts`, `lib/api/contest.ts`, `lib/api/futures.ts`, `lib/api/trade.ts` |
| `web/app/(default)/community/[category]/[id]/page.tsx` | `lib/api/post.server.ts`, `app/(default)/community/[category]/[id]/CategoryDetailClient.tsx` | `lib/api/post.server.ts`, `lib/api/post.ts` |
| `web/app/(default)/community/[category]/page.tsx` | `app/(default)/community/components/CommunityContainer.tsx`, `app/(default)/community/components/CommunityTabs.tsx`, `app/(default)/community/constants.ts`, `lib/api/post.server.ts` | `lib/api/community-ux.ts`, `lib/api/post.server.ts`, `lib/api/post.ts` |
| `web/app/(default)/community/page.tsx` |  | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(default)/design/page.tsx` | `components/icons/index.ts`, `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/ui/Select.tsx`, `components/ui/Tabs.tsx`, `components/icons/index.ts`, `components/ui/Button.tsx`, `components/ui/Input.tsx` | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(default)/me/page.tsx` | `stores/useAuthStore.ts`, `hooks/useBinanceWebSocket.ts`, `stores/useTickerStore.ts`, `stores/useMarketStore.ts`, `lib/utils/notification-sse.ts`, `lib/utils/cs.ts`, `lib/api/me-community.ts`, `app/(default)/community/types/post.ts`, `components/user/profile/ProfileSidebar.tsx`, `components/user/profile/ProfileCommunitySection.tsx`, `components/user/profile/FollowMembersModal.tsx`, `components/user/profile/types.ts`, `lib/api/member.ts`, `components/ui/FolderTabs.tsx`, `components/ui/Tabs.tsx`, `components/ui/Button.tsx`, `components/ui/Select.tsx`, `components/trade/TickerCell.tsx`, `components/asset/AssetSummaryCard.tsx`, `components/ui/FeedbackProvider.tsx`, `lib/utils/number.ts`, `lib/utils/futures-position.ts`, `lib/utils/market-display.ts`, `lib/api/asset.ts`, `lib/api/contest.ts`, `lib/api/contest-futures.ts`, `types/futures.ts` | `lib/api/asset.ts`, `lib/api/contest-futures.ts`, `lib/api/contest.ts`, `lib/api/me-community.ts`, `lib/api/member.ts` |
| `web/app/(default)/me/settings/page.tsx` | `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/AddressSearchModal.tsx`, `components/ui/FeedbackProvider.tsx`, `stores/useAuthStore.ts`, `types/member.ts`, `lib/api/client.ts`, `lib/api/member.ts`, `lib/utils/phone.ts` | `lib/api/member.ts` |
| `web/app/(default)/member/[memberId]/page.tsx` | `app/(default)/community/types/post.ts`, `components/ui/FeedbackProvider.tsx`, `components/ui/Button.tsx`, `components/user/profile/ProfileSidebar.tsx`, `components/user/profile/ProfileCommunitySection.tsx`, `components/user/profile/types.ts`, `lib/api/me-community.ts`, `lib/api/member.ts`, `stores/useAuthStore.ts`, `lib/api/portfolio.ts`, `lib/api/contest.ts`, `lib/api/contest-futures.ts`, `components/ui/FolderTabs.tsx`, `components/ui/Tabs.tsx`, `components/ui/Select.tsx`, `lib/utils/cs.ts`, `lib/utils/number.ts`, `lib/utils/cs.ts`, `lib/utils/market-display.ts`, `stores/useMarketStore.ts`, `components/trade/TickerCell.tsx`, `types/futures.ts`, `lib/api/asset.ts` | `lib/api/asset.ts`, `lib/api/contest-futures.ts`, `lib/api/contest.ts`, `lib/api/me-community.ts`, `lib/api/member.ts`, `lib/api/portfolio.ts` |
| `web/app/(default)/notifications/page.tsx` | `components/notifications/NotificationsPageView.tsx` | `lib/api/notifications.ts` |
| `web/app/(default)/rank/page.tsx` | `app/(default)/rank/components/RankItem.tsx`, `app/(default)/rank/types/user.ts`, `stores/useAuthStore.ts`, `stores/useUIStore.ts`, `components/ui/Tabs.tsx`, `components/ui/Select.tsx`, `components/ui/FeedbackProvider.tsx`, `lib/api/member.ts`, `lib/api/post.ts`, `lib/api/contest.ts` | `lib/api/contest.ts`, `lib/api/member.ts`, `lib/api/post.ts` |
| `web/app/(full)/login/page.tsx` | `components/icons/index.ts`, `components/ui/Button.tsx`, `components/ui/Logo.tsx` | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(full)/policy/privacy/page.tsx` | `components/policy/PrivacyContent.tsx` | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(full)/policy/terms/page.tsx` | `components/policy/TermsContent.tsx` | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(full)/signup/benefits/page.tsx` | `components/ui/Button.tsx` | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |
| `web/app/(full)/signup/page.tsx` | `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/ui/FeedbackProvider.tsx`, `stores/useAuthStore.ts`, `lib/api/member.ts`, `components/PolicyModal.tsx`, `components/ui/Logo.tsx` | `lib/api/member.ts` |
| `web/app/(full)/verify/page.tsx` | `components/AddressSearchModal.tsx`, `components/ui/Logo.tsx`, `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/ui/FeedbackProvider.tsx`, `lib/api/member.ts`, `lib/api/client.ts`, `lib/utils/phone.ts`, `lib/utils/notification-sse.ts`, `stores/useAuthStore.ts` | `lib/api/member.ts` |
| `web/app/(main)/page.tsx` | `components/ui/Button.tsx`, `components/contest/ContestFloatingButton.tsx`, `app/(main)/component/SimpleChart.tsx`, `hooks/useBinanceTickers.ts`, `lib/api/post.ts`, `app/(default)/community/types/post.ts`, `lib/utils/date.ts`, `lib/utils/cs.ts` | `lib/api/contest.ts`, `lib/api/post.ts` |
| `web/app/(trade-full)/contest/[seasonId]/trading/page.tsx` | `components/trade/CoinHeader.tsx`, `components/trade/CoinChart.tsx`, `components/trade/OrderBook.tsx`, `components/trade/RecentTrades.tsx`, `components/trade/CoinList.tsx`, `components/trade/CoinListDrawer.tsx`, `components/futures/trading/FuturesActivitySection.tsx`, `components/futures/trading/FuturesOrderPanel.tsx`, `hooks/useContestFuturesTradingSession.ts`, `hooks/useBinanceWebSocket.ts`, `lib/utils/cs.ts`, `lib/utils/number.ts`, `lib/utils/futures.ts`, `types/futures.ts`, `components/ui/Tabs.tsx` | `lib/api/contest-futures.ts`, `lib/api/contest.ts`, `lib/api/favorite.ts`, `lib/api/futures.ts` |
| `web/app/(trade-full)/contest/page.tsx` | `components/ui/FeedbackProvider.tsx`, `hooks/useWithAuth.ts`, `lib/api/contest.ts`, `stores/useAuthStore.ts`, `app/(trade-full)/contest/components/ContestListCard.tsx`, `app/(trade-full)/contest/components/ContestOngoingSection.tsx`, `components/ui/Button.tsx`, `components/ui/Tabs.tsx`, `app/(trade-full)/contest/components/types.ts` | `lib/api/contest.ts` |
| `web/app/(trade-full)/mock/page.tsx` | `components/trade/CoinHeader.tsx`, `components/trade/CoinChart.tsx`, `components/trade/OrderBook.tsx`, `components/trade/RecentTrades.tsx`, `components/trade/CoinList.tsx`, `components/trade/OrderForm.tsx`, `components/trade/UserOrderHistory.tsx`, `components/mock/MockNoticeBar.tsx`, `components/trade/CoinListDrawer.tsx`, `components/ui/Tabs.tsx`, `hooks/useBinanceWebSocket.ts`, `stores/useMockWalletStore.ts`, `stores/useUIStore.ts`, `lib/utils/cs.ts` | `lib/api/favorite.ts`, `lib/api/trade.ts` |
| `web/app/(trade-full)/trading/page.tsx` | `components/trade/CoinHeader.tsx`, `components/trade/CoinChart.tsx`, `components/trade/OrderBook.tsx`, `components/trade/RecentTrades.tsx`, `components/trade/CoinList.tsx`, `components/trade/OrderForm.tsx`, `components/trade/UserOrderHistory.tsx`, `components/trade/CoinListDrawer.tsx`, `components/futures/trading/FuturesActivitySection.tsx`, `components/futures/trading/FuturesOrderPanel.tsx`, `hooks/useFuturesTradingSession.ts`, `hooks/useBinanceWebSocket.ts`, `lib/utils/cs.ts`, `lib/utils/number.ts`, `components/ui/Tabs.tsx`, `components/quest/TradingLockedOverlay.tsx`, `stores/useQuestStore.ts`, `components/asset/AssetTransferModal.tsx`, `components/ui/FeedbackProvider.tsx`, `stores/useAuthStore.ts`, `hooks/useWithAuth.ts`, `stores/useTickerStore.ts`, `stores/useUIStore.ts` | `lib/api/contest-futures.ts`, `lib/api/favorite.ts`, `lib/api/futures.ts`, `lib/api/trade.ts` |
| `web/app/test22/page.tsx` | `hooks/useBinanceTickers.ts` | 없음: 인라인 호출·정적 화면·redirect 여부 별도 확인 |

## API export 및 호출 근거

| V1 API 파일 | export | 정의 이외 호출 위치 |
|---|---|---|
| `web/lib/api/admin-community.ts` | `getAdminPosts` | `web/app/(admin)/admin/community/page.tsx:110` |
| `web/lib/api/admin-community.ts` | `deletePostByAdmin` | `web/app/(admin)/admin/community/components/PostDetailModal.tsx:42` |
| `web/lib/api/admin-community.ts` | `getAdminReplies` | `web/app/(admin)/admin/community/page.tsx:182` |
| `web/lib/api/admin-community.ts` | `deleteReplyByAdmin` | `web/app/(admin)/admin/community/components/ReplyDetailModal.tsx:42` |
| `web/lib/api/admin-contest.ts` | `createContestSeason` | `web/app/(admin)/admin/contest/components/ContestCreateModal.tsx:131` |
| `web/lib/api/admin-contest.ts` | `getAdminContestSeasons` | `web/app/(admin)/admin/contest/page.tsx:197` |
| `web/lib/api/admin-contest.ts` | `getAdminContestSeasonById` | `web/app/(admin)/admin/contest/[seasonId]/page.tsx:140` |
| `web/lib/api/admin-contest.ts` | `updateContestSeason` | `web/app/(admin)/admin/contest/components/ContestEditModal.tsx:124` |
| `web/lib/api/admin-contest.ts` | `updateContestSeasonStatus` | `web/app/(admin)/admin/contest/page.tsx:315`, `web/app/(admin)/admin/contest/[seasonId]/page.tsx:189` |
| `web/lib/api/admin-contest.ts` | `getContestApplicants` | `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:127`, `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:387` |
| `web/lib/api/admin-contest.ts` | `getContestParticipants` | `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:128`, `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:399` |
| `web/lib/api/admin-contest.ts` | `getRejectedContestApplicants` | `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:129`, `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:410` |
| `web/lib/api/admin-contest.ts` | `approveContestApplicant` | `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:216` |
| `web/lib/api/admin-contest.ts` | `rejectContestApplicant` | `web/app/(admin)/admin/contest/components/ContestMembersManager.tsx:275` |
| `web/lib/api/admin-contest.ts` | `settleContestSeason` | `web/app/(admin)/admin/contest/[seasonId]/page.tsx:246` |
| `web/lib/api/admin-member.ts` | `getAdminMembers` | `web/app/(admin)/admin/users/page.tsx:75` |
| `web/lib/api/admin-member.ts` | `withdrawMemberByAdmin` | `web/app/(admin)/admin/users/components/UserDetailModal.tsx:42` |
| `web/lib/api/asset.ts` | `getUnifiedRealAssetDetail` | `web/app/(default)/assets/page.tsx:731`, `web/app/(default)/me/page.tsx:566`, `web/app/(default)/member/[memberId]/page.tsx:266` |
| `web/lib/api/asset.ts` | `getMySpotPortfolio` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/client.ts` | `fetchClient` | `web/components/asset/AssetTransferModal.tsx:56`, `web/components/asset/AssetTransferModal.tsx:74`, `web/components/asset/AssetTransferModal.tsx:116`, `web/lib/api/admin-community.ts:91`, `web/lib/api/admin-community.ts:98`, `web/lib/api/admin-community.ts:137`, `web/lib/api/admin-community.ts:144`, `web/lib/api/admin-contest.ts:94`, `web/lib/api/admin-contest.ts:126`, `web/lib/api/admin-contest.ts:157`, `web/lib/api/admin-contest.ts:174`, `web/lib/api/admin-contest.ts:203`, `web/lib/api/admin-contest.ts:231`, `web/lib/api/admin-contest.ts:259`, `web/lib/api/admin-contest.ts:271`, `web/lib/api/admin-contest.ts:285`, `web/lib/api/admin-contest.ts:298`, `web/lib/api/admin-member.ts:56`, `web/lib/api/admin-member.ts:63`, `web/lib/api/contest-futures.ts:209`, `web/lib/api/contest-futures.ts:222`, `web/lib/api/contest-futures.ts:235`, `web/lib/api/contest-futures.ts:251`, `web/lib/api/contest-futures.ts:268`, `web/lib/api/contest-futures.ts:286`, `web/lib/api/contest-futures.ts:305`, `web/lib/api/contest-futures.ts:332`, `web/lib/api/contest-futures.ts:351`, `web/lib/api/contest-futures.ts:378`, `web/lib/api/contest.ts:169`, `web/lib/api/contest.ts:176`, `web/lib/api/contest.ts:183`, `web/lib/api/contest.ts:190`, `web/lib/api/contest.ts:197`, `web/lib/api/contest.ts:207`, `web/lib/api/contest.ts:220`, `web/lib/api/contest.ts:230`, `web/lib/api/contest.ts:237`, `web/lib/api/contest.ts:256`, `web/lib/api/contest.ts:273`, `web/lib/api/contest.ts:293`, `web/lib/api/contest.ts:303`, `web/lib/api/contest.ts:312`, `web/lib/api/favorite.ts:4`, `web/lib/api/favorite.ts:20`, `web/lib/api/favorite.ts:26`, `web/lib/api/futures.ts:156`, `web/lib/api/futures.ts:171`, `web/lib/api/futures.ts:180`, `web/lib/api/futures.ts:189`, `web/lib/api/futures.ts:201`, `web/lib/api/futures.ts:215`, `web/lib/api/futures.ts:232`, `web/lib/api/futures.ts:247`, `web/lib/api/futures.ts:270`, `web/lib/api/futures.ts:285`, `web/lib/api/futures.ts:306`, `web/lib/api/me-community.ts:44`, `web/lib/api/me-community.ts:54`, `web/lib/api/me-community.ts:65`, `web/lib/api/me-community.ts:76`, `web/lib/api/me-community.ts:87`, `web/lib/api/me-community.ts:98`, `web/lib/api/me-community.ts:103`, `web/lib/api/me-community.ts:110`, `web/lib/api/member.ts:69`, `web/lib/api/member.ts:74`, `web/lib/api/member.ts:79`, `web/lib/api/member.ts:84`, `web/lib/api/member.ts:116`, `web/lib/api/member.ts:127`, `web/lib/api/member.ts:132`, `web/lib/api/member.ts:143`, `web/lib/api/member.ts:153`, `web/lib/api/member.ts:163`, `web/lib/api/member.ts:212`, `web/lib/api/member.ts:219`, `web/lib/api/member.ts:232`, `web/lib/api/member.ts:245`, `web/lib/api/notifications.ts:28`, `web/lib/api/notifications.ts:34`, `web/lib/api/notifications.ts:40`, `web/lib/api/notifications.ts:46`, `web/lib/api/notifications.ts:52`, `web/lib/api/notifications.ts:61`, `web/lib/api/notifications.ts:70`, `web/lib/api/post.ts:25`, `web/lib/api/post.ts:41`, `web/lib/api/post.ts:48`, `web/lib/api/post.ts:55`, `web/lib/api/post.ts:65`, `web/lib/api/post.ts:73`, `web/lib/api/post.ts:82`, `web/lib/api/post.ts:94`, `web/lib/api/post.ts:103`, `web/lib/api/post.ts:128`, `web/lib/api/post.ts:134`, `web/lib/api/post.ts:151`, `web/lib/api/post.ts:159`, `web/lib/api/post.ts:167`, `web/lib/api/post.ts:184`, `web/lib/api/post.ts:198`, `web/lib/api/post.ts:207`, `web/lib/api/post.ts:216`, `web/lib/api/trade.ts:192`, `web/lib/api/trade.ts:205`, `web/lib/api/trade.ts:217`, `web/lib/api/trade.ts:228`, `web/lib/api/trade.ts:239`, `web/lib/api/trade.ts:248`, `web/lib/api/trade.ts:257` |
| `web/lib/api/community-ux.ts` | `COMMUNITY_UX_POST_CREATED_EVENT` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/community-ux.ts` | `subscribeCommunityFeed` | `web/app/(default)/community/components/CommunityContainer.tsx:126` |
| `web/lib/api/community-ux.ts` | `isPostCreatedUxEvent` | `web/app/(default)/community/components/CommunityContainer.tsx:136` |
| `web/lib/api/contest-futures.ts` | `getFuturesWalletStatus` | `web/app/(default)/assets/page.tsx:816`, `web/app/(default)/me/page.tsx:648`, `web/app/(default)/member/[memberId]/page.tsx:368`, `web/hooks/useContestFuturesTradingSession.ts:229`, `web/hooks/useContestFuturesTradingSession.ts:373` |
| `web/lib/api/contest-futures.ts` | `getFinishedContestWalletStatus` | `web/app/(default)/assets/page.tsx:813`, `web/app/(default)/me/page.tsx:647`, `web/app/(default)/member/[memberId]/page.tsx:365` |
| `web/lib/api/contest-futures.ts` | `getContestFuturesOpenPositions` | `web/app/(default)/assets/page.tsx:817`, `web/app/(default)/me/page.tsx:680`, `web/app/(default)/member/[memberId]/page.tsx:369`, `web/hooks/useContestFuturesTradingSession.ts:230`, `web/hooks/useContestFuturesTradingSession.ts:374` |
| `web/lib/api/contest-futures.ts` | `getContestFuturesClosedPositions` | `web/app/(default)/assets/page.tsx:1040`, `web/components/futures/trading/ClosedPositionsTab.tsx:61` |
| `web/lib/api/contest-futures.ts` | `getContestFuturesOrders` | `web/app/(default)/assets/page.tsx:896`, `web/app/(default)/assets/page.tsx:953`, `web/components/futures/trading/FuturesOrderList.tsx:148`, `web/hooks/useContestFuturesTradingSession.ts:195` |
| `web/lib/api/contest-futures.ts` | `getContestFuturesLeverage` | `web/hooks/useContestFuturesTradingSession.ts:165`, `web/hooks/useContestFuturesTradingSession.ts:264` |
| `web/lib/api/contest-futures.ts` | `updateContestFuturesLeverage` | `web/hooks/useContestFuturesTradingSession.ts:479`, `web/hooks/useContestFuturesTradingSession.ts:532` |
| `web/lib/api/contest-futures.ts` | `placeContestFuturesOpenMarketOrder` | `web/hooks/useContestFuturesTradingSession.ts:576` |
| `web/lib/api/contest-futures.ts` | `placeContestFuturesOpenLimitOrder` | `web/hooks/useContestFuturesTradingSession.ts:606` |
| `web/lib/api/contest-futures.ts` | `placeContestFuturesCloseMarketOrder` | `web/hooks/useContestFuturesTradingSession.ts:636` |
| `web/lib/api/contest-futures.ts` | `placeContestFuturesCloseLimitOrder` | `web/hooks/useContestFuturesTradingSession.ts:666` |
| `web/lib/api/contest-futures.ts` | `cancelContestFuturesLimitOrder` | `web/hooks/useContestFuturesTradingSession.ts:696` |
| `web/lib/api/contest.ts` | `translateContestDisplayStatus` | `web/app/(admin)/admin/contest/page.tsx:53`, `web/app/(admin)/admin/contest/[seasonId]/page.tsx:88`, `web/app/(trade-full)/contest/page.tsx:59`, `web/components/contest/ContestDetailModal.tsx:215`, `web/components/user/profile/ProfileContestHistorySection.tsx:49` |
| `web/lib/api/contest.ts` | `inferContestIsPublic` | `web/app/(admin)/admin/contest/page.tsx:54`, `web/app/(admin)/admin/contest/page.tsx:267`, `web/app/(admin)/admin/contest/[seasonId]/page.tsx:91` |
| `web/lib/api/contest.ts` | `inferContestIsCanceled` | `web/app/(admin)/admin/contest/page.tsx:55`, `web/app/(admin)/admin/contest/page.tsx:268`, `web/app/(admin)/admin/contest/[seasonId]/page.tsx:92` |
| `web/lib/api/contest.ts` | `getRecruitingContestSeasons` | `web/app/(trade-full)/contest/page.tsx:168`, `web/components/contest/ContestDetailModal.tsx:54`, `web/components/contest/ContestDetailModal.tsx:155` |
| `web/lib/api/contest.ts` | `getPublishedContestSeasons` | `web/app/(trade-full)/contest/page.tsx:169` |
| `web/lib/api/contest.ts` | `getFinishedContestSeasons` | `web/app/(default)/rank/page.tsx:161`, `web/app/(trade-full)/contest/page.tsx:170` |
| `web/lib/api/contest.ts` | `applyContestSeason` | `web/app/(trade-full)/contest/page.tsx:213`, `web/components/contest/ContestDetailModal.tsx:126` |
| `web/lib/api/contest.ts` | `getContestSeasonStatuses` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/contest.ts` | `getContestParticipationSeasonsByMember` | `web/app/(default)/assets/page.tsx:748`, `web/app/(default)/me/page.tsx:593`, `web/app/(default)/member/[memberId]/page.tsx:331` |
| `web/lib/api/contest.ts` | `getMyParticipatingContestSeasons` | `web/app/(default)/assets/page.tsx:757`, `web/app/(trade-full)/contest/page.tsx:173`, `web/hooks/useContestFuturesTradingSession.ts:117` |
| `web/lib/api/contest.ts` | `getMyPendingContestApplications` | `web/app/(trade-full)/contest/page.tsx:174` |
| `web/lib/api/contest.ts` | `getMyLatestRejectedContestApplication` | `web/app/(trade-full)/contest/page.tsx:175` |
| `web/lib/api/contest.ts` | `getMyContestSeasonResult` | `web/app/(default)/assets/page.tsx:857`, `web/app/(default)/me/page.tsx:623` |
| `web/lib/api/contest.ts` | `getMemberContestSeasonResult` | `web/app/(default)/member/[memberId]/page.tsx:402` |
| `web/lib/api/contest.ts` | `getContestResults` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/contest.ts` | `getPublicContestResults` | `web/app/(default)/rank/page.tsx:184`, `web/app/(default)/rank/page.tsx:202` |
| `web/lib/api/contest.ts` | `getLatestFinishedContestResults` | `web/app/(default)/community/components/Top5Wrapper.tsx:21` |
| `web/lib/api/favorite.ts` | `getFavorites` | `web/stores/useFavoriteStore.ts:18` |
| `web/lib/api/favorite.ts` | `addFavorite` | `web/stores/useFavoriteStore.ts:42` |
| `web/lib/api/favorite.ts` | `removeFavorite` | `web/stores/useFavoriteStore.ts:40` |
| `web/lib/api/futures.ts` | `getRealFuturesWalletBalance` | `web/hooks/useFuturesTradingSession.ts:70` |
| `web/lib/api/futures.ts` | `getFuturesOpenPositions` | `web/hooks/useFuturesTradingSession.ts:71` |
| `web/lib/api/futures.ts` | `getFuturesClosedPositions` | `web/app/(default)/assets/page.tsx:1060`, `web/components/futures/trading/ClosedPositionsTab.tsx:62` |
| `web/lib/api/futures.ts` | `getFuturesOrders` | `web/app/(default)/assets/page.tsx:906`, `web/app/(default)/assets/page.tsx:976`, `web/components/futures/trading/FuturesOrderList.tsx:149`, `web/hooks/useFuturesTradingSession.ts:72`, `web/hooks/useRealTradingQuest.ts:49` |
| `web/lib/api/futures.ts` | `getFuturesLeverage` | `web/hooks/useFuturesTradingSession.ts:118` |
| `web/lib/api/futures.ts` | `updateFuturesLeverage` | `web/hooks/useFuturesTradingSession.ts:136` |
| `web/lib/api/futures.ts` | `placeFuturesOpenMarketOrder` | `web/hooks/useFuturesTradingSession.ts:150` |
| `web/lib/api/futures.ts` | `placeFuturesOpenLimitOrder` | `web/hooks/useFuturesTradingSession.ts:161` |
| `web/lib/api/futures.ts` | `placeFuturesCloseMarketOrder` | `web/hooks/useFuturesTradingSession.ts:172` |
| `web/lib/api/futures.ts` | `placeFuturesCloseLimitOrder` | `web/hooks/useFuturesTradingSession.ts:183` |
| `web/lib/api/futures.ts` | `cancelFuturesLimitOrder` | `web/hooks/useFuturesTradingSession.ts:194` |
| `web/lib/api/me-community.ts` | `getMemberPosts` | `web/app/(default)/me/page.tsx:775`, `web/app/(default)/member/[memberId]/page.tsx:169` |
| `web/lib/api/me-community.ts` | `getMemberReplies` | `web/app/(default)/me/page.tsx:863`, `web/app/(default)/member/[memberId]/page.tsx:208` |
| `web/lib/api/me-community.ts` | `getLikedPosts` | `web/app/(default)/me/page.tsx:902` |
| `web/lib/api/me-community.ts` | `getLikedReplies` | `web/app/(default)/me/page.tsx:943` |
| `web/lib/api/me-community.ts` | `getReportedPosts` | `web/app/(default)/me/page.tsx:985` |
| `web/lib/api/me-community.ts` | `getReportedReplies` | `web/app/(default)/me/page.tsx:986` |
| `web/lib/api/me-community.ts` | `cancelReportedPost` | `web/app/(default)/me/page.tsx:1098` |
| `web/lib/api/me-community.ts` | `cancelReportedReply` | `web/app/(default)/me/page.tsx:1101` |
| `web/lib/api/member.ts` | `getMemberInfo` | `web/app/(default)/community/components/Top5Wrapper.tsx:37`, `web/app/(default)/member/[memberId]/page.tsx:131`, `web/app/(default)/rank/page.tsx:109` |
| `web/lib/api/member.ts` | `getMyMemberInfo` | `web/app/(full)/signup/page.tsx:194`, `web/app/(full)/verify/page.tsx:270` |
| `web/lib/api/member.ts` | `getMyMemberProfile` | `web/app/(default)/me/settings/page.tsx:98` |
| `web/lib/api/member.ts` | `getMyVerifiedInfo` | `web/app/(default)/me/settings/page.tsx:106` |
| `web/lib/api/member.ts` | `updateMyProfileInfo` | `web/app/(default)/me/settings/page.tsx:301` |
| `web/lib/api/member.ts` | `getOAuthEmail` | `web/app/(full)/verify/page.tsx:77` |
| `web/lib/api/member.ts` | `sendEmailVerificationCode` | `web/app/(full)/verify/page.tsx:179` |
| `web/lib/api/member.ts` | `verifyEmailVerificationCode` | `web/app/(full)/verify/page.tsx:217` |
| `web/lib/api/member.ts` | `completeMemberVerification` | `web/app/(full)/verify/page.tsx:260` |
| `web/lib/api/member.ts` | `updateMyVerifiedInfo` | `web/app/(default)/me/settings/page.tsx:310` |
| `web/lib/api/member.ts` | `followMember` | `web/app/(default)/community/components/Top5.tsx:82`, `web/app/(default)/member/[memberId]/page.tsx:534`, `web/app/(default)/rank/page.tsx:304` |
| `web/lib/api/member.ts` | `unfollowMember` | `web/app/(default)/community/components/Top5.tsx:79`, `web/app/(default)/member/[memberId]/page.tsx:533`, `web/app/(default)/rank/page.tsx:281` |
| `web/lib/api/member.ts` | `getMemberFollowers` | `web/app/(default)/me/page.tsx:815`, `web/app/(default)/me/page.tsx:1059` |
| `web/lib/api/member.ts` | `getMemberFollowings` | `web/app/(default)/me/page.tsx:818`, `web/app/(default)/me/page.tsx:1063` |
| `web/lib/api/notifications.ts` | `subscribeNotifications` | `web/app/SSEProvider.tsx:107` |
| `web/lib/api/notifications.ts` | `getNotifications` | `web/components/Header.tsx:256`, `web/components/Header.tsx:276`, `web/components/notifications/NotificationsPageView.tsx:298`, `web/components/notifications/NotificationsPageView.tsx:455`, `web/components/notifications/NotificationsPageView.tsx:472`, `web/components/notifications/NotificationsPageView.tsx:608` |
| `web/lib/api/notifications.ts` | `checkNotifications` | `web/components/Header.tsx:295`, `web/components/Header.tsx:310`, `web/components/notifications/NotificationsPageView.tsx:532`, `web/components/notifications/NotificationsPageView.tsx:799` |
| `web/lib/api/notifications.ts` | `readAllNotifications` | `web/components/Header.tsx:328`, `web/components/notifications/NotificationsPageView.tsx:703` |
| `web/lib/api/notifications.ts` | `readNotification` | `web/components/Header.tsx:377`, `web/components/notifications/NotificationsPageView.tsx:875` |
| `web/lib/api/notifications.ts` | `readSelectedNotifications` | `web/components/notifications/NotificationsPageView.tsx:668` |
| `web/lib/api/notifications.ts` | `deleteSelectedNotifications` | `web/components/notifications/NotificationsPageView.tsx:736` |
| `web/lib/api/notifications.ts` | `deleteReadNotifications` | `web/components/notifications/NotificationsPageView.tsx:774` |
| `web/lib/api/portfolio.ts` | `getMyProfilePortfolio` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/portfolio.ts` | `getMemberPortfolio` | `web/app/(default)/member/[memberId]/page.tsx:245`, `web/app/(default)/member/[memberId]/page.tsx:285`, `web/app/(default)/member/[memberId]/page.tsx:306` |
| `web/lib/api/post.server.ts` | `getPostsServer` | `web/app/(default)/community/[category]/page.tsx:18` |
| `web/lib/api/post.server.ts` | `getPostServer` | `web/app/(default)/community/[category]/[id]/page.tsx:15` |
| `web/lib/api/post.server.ts` | `getReplysServer` | `web/app/(default)/community/[category]/[id]/page.tsx:16` |
| `web/lib/api/post.ts` | `createPost` | `web/app/(default)/community/components/WriteModal.tsx:174` |
| `web/lib/api/post.ts` | `getPosts` | `web/app/(default)/community/components/CommunityContainer.tsx:85`, `web/app/(default)/community/components/CommunityContainer.tsx:194`, `web/app/(default)/community/components/CommunityList.tsx:35`, `web/app/(default)/rank/page.tsx:51`, `web/app/(main)/page.tsx:221` |
| `web/lib/api/post.ts` | `getPost` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/post.ts` | `putPost` | `web/app/(default)/community/components/WriteModal.tsx:198` |
| `web/lib/api/post.ts` | `putLike` | `web/app/(default)/community/components/CommunityItem.tsx:164` |
| `web/lib/api/post.ts` | `deleteLike` | `web/app/(default)/community/components/CommunityItem.tsx:153` |
| `web/lib/api/post.ts` | `deletePost` | `web/app/(default)/community/components/CommunityItem.tsx:95` |
| `web/lib/api/post.ts` | `reportPost` | `web/app/(default)/community/components/ReportModal.tsx:45` |
| `web/lib/api/post.ts` | `unreportPost` | `web/app/(default)/community/components/CommunityItem.tsx:121` |
| `web/lib/api/post.ts` | `getReplys` | `web/app/(default)/community/components/comment/CommentContainer.tsx:242`, `web/app/(default)/community/components/comment/CommentContainer.tsx:510` |
| `web/lib/api/post.ts` | `createReply` | `web/app/(default)/community/components/comment/CommentForm.tsx:122` |
| `web/lib/api/post.ts` | `putReply` | `web/app/(default)/community/components/comment/CommentForm.tsx:82` |
| `web/lib/api/post.ts` | `putReplyLike` | `web/app/(default)/community/components/comment/CommentContainer.tsx:118` |
| `web/lib/api/post.ts` | `deleteReplyLike` | `web/app/(default)/community/components/comment/CommentContainer.tsx:107` |
| `web/lib/api/post.ts` | `deleteReply` | `web/app/(default)/community/components/comment/CommentContainer.tsx:172` |
| `web/lib/api/post.ts` | `reportReply` | `web/app/(default)/community/components/ReportModal.tsx:43` |
| `web/lib/api/post.ts` | `unreportReply` | `web/app/(default)/community/components/comment/CommentContainer.tsx:208` |
| `web/lib/api/post.ts` | `getReportEnum` | `web/app/(default)/community/components/ReportModal.tsx:82` |
| `web/lib/api/server.ts` | `serverFetchClient` | `web/lib/api/post.server.ts:7`, `web/lib/api/post.server.ts:14`, `web/lib/api/post.server.ts:21` |
| `web/lib/api/trade.ts` | `placeMarketOrder` | `web/components/trade/OrderForm.tsx:303`, `web/stores/useMockWalletStore.ts:641` |
| `web/lib/api/trade.ts` | `placeLimitOrder` | `web/components/trade/OrderForm.tsx:270`, `web/stores/useMockWalletStore.ts:686` |
| `web/lib/api/trade.ts` | `fetchOrders` | `web/app/(default)/assets/page.tsx:963`, `web/app/(default)/assets/page.tsx:985`, `web/components/trade/UserOrderHistory.tsx:132` |
| `web/lib/api/trade.ts` | `fetchOpenOrders` | `web/app/(default)/assets/page.tsx:903`, `web/app/(default)/assets/page.tsx:912`, `web/components/trade/UserOrderHistory.tsx:125` |
| `web/lib/api/trade.ts` | `fetchTradeHistories` | `web/app/(default)/assets/page.tsx:1050`, `web/app/(default)/assets/page.tsx:1069`, `web/hooks/useRealTradingQuest.ts:36` |
| `web/lib/api/trade.ts` | `fetchRealSpotAssetDetail` | `web/app/(trade-full)/trading/page.tsx:65`, `web/components/trade/OrderForm.tsx:106` |
| `web/lib/api/trade.ts` | `cancelOrder` | `web/components/trade/UserOrderHistory.tsx:230` |
| `web/lib/api/trade.ts` | `buildTradeQueryParams` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/trade.ts` | `extractApiMessage` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |
| `web/lib/api/trade.ts` | `parseCursorResponse` | 호출 없음: UNVERIFIED / 상수·유틸 가능 |

## API 모듈 외 직접 통신·이벤트·브라우저 저장소

| 소스 | 호출 근거 |
|---|---|
| `web/app/(admin)/AdminGuard.tsx` | 25: `const response = await fetch(${process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8080'}/api/v1/member/me/info, {` |
| `web/app/(default)/me/page.tsx` | 510: `const response = await fetch(/api/v1/member/me/info, {`<br>709: `const portfolioResponse = await fetch(`<br>1126: `await fetch(/api/v1/auth/logout, {`<br>1159: `const response = await fetch(${process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8080'}/api/v1/member/me, {` |
| `web/app/(default)/me/settings/page.tsx` | 185: `const response = await fetch(` |
| `web/app/(full)/login/page.tsx` | 10: `window.sessionStorage.setItem("needs-auth-sync", "1");` |
| `web/app/(full)/signup/page.tsx` | 103: `const response = await fetch(/api/v1/member/nickname/duplication?nickname=${encodeURIComponent(nickname)}, {`<br>173: `const response = await fetch(${process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8080'}/api/v1/auth/signup, {` |
| `web/app/(full)/verify/page.tsx` | 267: `window.sessionStorage.setItem("needs-auth-sync", "1");` |
| `web/app/(main)/page.tsx` | 55: `const res = await fetch("https://open.er-api.com/v6/latest/USD");` |
| `web/app/AuthBootstrap.tsx` | 26: `const needsAuthSync = window.sessionStorage.getItem(AUTH_SYNC_FLAG) === "1";`<br>38: `const response = await fetch(${process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8080'}/api/v1/member/me/info, {`<br>44: `window.sessionStorage.removeItem(AUTH_SYNC_FLAG);`<br>59: `window.sessionStorage.removeItem(AUTH_SYNC_FLAG);` |
| `web/components/admin/AdminHeader.tsx` | 42: `await fetch(${process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8080'}/api/v1/auth/logout, {` |
| `web/components/asset/AssetTransferModal.tsx` | 56: `const data = await fetchClient(real/assets/transferable?assetType=${fromType});`<br>74: `const data = await fetchClient("real/assets/transfer/history");`<br>116: `await fetchClient("real/assets/transfer", {` |
| `web/components/mock/MockNoticeBar.tsx` | 64: `const response = await fetch(${process.env.NEXT_PUBLIC_API_URL \|\| 'http://localhost:8080'}/api/v1/member/me/info, {` |
| `web/components/trade/CoinChart.tsx` | 514: `const res = await fetch(`<br>552: `fetch(`<br>609: `const socket = new WebSocket(` |
| `web/components/trade/OrderBook.tsx` | 109: `const ws = new WebSocket(` |
| `web/components/trade/RecentTrades.tsx` | 93: `const res = await fetch(url);`<br>120: `const ws = new WebSocket(` |
| `web/hooks/useBinanceTickers.ts` | 34: `const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');` |
| `web/hooks/useBinanceWebSocket.ts` | 146: `const response = await fetch(getMarketSymbolsApiUrl(effectiveMarketType), {`<br>186: `const response = await fetch(getBinance24hrTickerApiUrl(effectiveMarketType));`<br>220: `const ws = new WebSocket(` |
| `web/stores/useMarketStore.ts` | 30: `// Based on AssetsPage, it was fetch("http://localhost:8080/api/v1/market/spot/symbols")` |
| `web/stores/useMockWalletStore.ts` | 379: `const statusResponse = await fetch(${MOCK_ASSET_API_BASE}/status, {`<br>444: `const response = await fetch(${MOCK_ASSET_API_BASE}/portfolio, {`<br>524: `const response = await fetch(${MOCK_ASSET_API_BASE}/participate, {`<br>570: `const response = await fetch(${MOCK_ASSET_API_BASE}/give-up, {` |

## V1 Backend 실제 Controller 계약

| Controller | 클래스 prefix | 매핑된 동작 |
|---|---|---|
| `was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java` | `@RequestMapping("/api/v1/asset/mock")` | `@GetMapping("/status")`<br>`@PostMapping("/participate")`<br>`@PostMapping("/give-up")`<br>`@GetMapping("/portfolio")` |
| `was/src/main/java/com/yogimangchi/domain/asset/controller/v1/RealAssetController.java` | `@RequestMapping("/api/v1/asset/real")` | `@GetMapping("/detail")` |
| `was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java` | `@RequestMapping("/api/v1/auth")` | `@GetMapping("/signup-info")`<br>`@PostMapping("/signup")`<br>`@PostMapping("/refresh")`<br>`@PostMapping("/logout")` |
| `was/src/main/java/com/yogimangchi/domain/chartapi/controller/v1/ChartApiController.java` | `@RequestMapping("/api/v1/chartapi")` | `@GetMapping("/prices")`<br>`@GetMapping("/prices/{symbol}")`<br>`@GetMapping("/candles/{symbol}")` |
| `was/src/main/java/com/yogimangchi/domain/chartist/controller/v1/ChartistController.java` | `@RequestMapping("/api/v1/chartist")` | `@GetMapping("/seasons/{seasonId}/results")` |
| `was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java` | `@RequestMapping("/api/v1/admin/community")` | `@GetMapping("/posts")`<br>`@GetMapping("/posts/withdrawn-author")`<br>`@GetMapping("/posts/active-author")`<br>`@DeleteMapping("/posts/{postId}")`<br>`@GetMapping("/replies")`<br>`@GetMapping("/replies/withdrawn-author")`<br>`@GetMapping("/replies/active-author")`<br>`@DeleteMapping("/replies/{replyId}")` |
| `was/src/main/java/com/yogimangchi/domain/community/controller/v1/CommunityUxController.java` | `@RequestMapping("/api/v1/community/ux")` | `@GetMapping(value = "/subscribe/feed", produces = MediaType.TEXT_EVENT_STREAM_VALUE)` |
| `was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java` | `@RequestMapping("/api/v1/community")` | `@PutMapping("/posts/{postId}/likes")`<br>`@DeleteMapping("/posts/{postId}/likes")`<br>`@PutMapping("/posts/{postId}/replys/{replyId}/likes")`<br>`@DeleteMapping("/posts/{postId}/replys/{replyId}/likes")` |
| `was/src/main/java/com/yogimangchi/domain/community/controller/v1/MyCommunityController.java` | `@RequestMapping("/api/v1/me/community")` | `@GetMapping("/liked-posts")`<br>`@GetMapping("/liked-replys")` |
| `was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java` | `@RequestMapping("/api/v1/community")` | `@GetMapping("/posts")`<br>`@GetMapping("/member/{memberId}/posts")`<br>`@GetMapping("/posts/{postId}")`<br>`@PostMapping(value = "/posts", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)`<br>`@PutMapping(value = "/posts/{postId}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)`<br>`@DeleteMapping(value = "/posts/{postId}")` |
| `was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java` | `@RequestMapping("/api/v1/community")` | `@GetMapping("/posts/{postId}/replys")`<br>`@GetMapping("/member/{memberId}/replys")`<br>`@PostMapping("/posts/{postId}/replys")`<br>`@PutMapping("/posts/{postId}/replys")`<br>`@DeleteMapping("/posts/{postId}/replys")` |
| `was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java` | `@RequestMapping("/api/v1/admin/contest")` | `@PostMapping("/seasons")`<br>`@PutMapping("/seasons/{seasonId}")`<br>`@PatchMapping("/seasons/{seasonId}/status")`<br>`@GetMapping("/seasons/{seasonId}/applicants")`<br>`@PostMapping("/seasons/{seasonId}/applicants/{applicantId}/approve")`<br>`@PostMapping("/seasons/{seasonId}/applicants/{applicantId}/reject")`<br>`@GetMapping("/seasons/{seasonId}/participants")`<br>`@GetMapping("/seasons/{seasonId}/rejected-applicants")`<br>`@GetMapping("/seasons")`<br>`@PostMapping("/seasons/{seasonId}/settlement")` |
| `was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java` | `@RequestMapping("/api/v1/contest")` | `@GetMapping("/seasons/statuses")`<br>`@GetMapping("/seasons/recruiting")`<br>`@GetMapping("/member/{memberId}/participation-seasons")`<br>`@PostMapping("/seasons/{seasonId}/applications")`<br>`@GetMapping("/seasons/{seasonId}/results")`<br>`@GetMapping("/seasons/{seasonId}/members/{memberId}/result")` |
| `was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java` | `@RequestMapping("/api/v1/me/contest")` | `@GetMapping("/pending-applications")`<br>`@GetMapping("/participating-seasons")`<br>`@GetMapping("/rejected-applications/latest")`<br>`@GetMapping("/seasons/{seasonId}/result")` |
| `was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java` | `@RequestMapping("/api/v1/contest/public")` | `@GetMapping("/recruiting")`<br>`@GetMapping("/running")`<br>`@GetMapping("/finished")`<br>`@GetMapping("/seasons/{seasonId}/results")`<br>`@GetMapping("/seasons/latest-finished/results")` |
| `was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesAssetController.java` | `@RequestMapping("/api/v1/futures/contest")` | `@GetMapping("/{contestSeasonId}/wallet/status")`<br>`@GetMapping("/{contestSeasonId}/wallet/status/finished")` |
| `was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesLeverageController.java` | `@RequestMapping("/api/v1/futures/contest")` | `@GetMapping("/{contestSeasonId}/leverage")`<br>`@PutMapping("/{contestSeasonId}/leverage")` |
| `was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java` | `@RequestMapping("/api/v1/futures/contest")` | `@PostMapping("/{contestSeasonId}/order/market/open")`<br>`@PostMapping("/{contestSeasonId}/order/market/close")`<br>`@PostMapping("/{contestSeasonId}/order/limit/open")`<br>`@PostMapping("/{contestSeasonId}/order/limit/close")`<br>`@DeleteMapping("/{contestSeasonId}/order/limit/{orderId}")`<br>`@GetMapping("/{contestSeasonId}/orders")`<br>`@GetMapping("/{contestSeasonId}/positions/open")`<br>`@GetMapping("/{contestSeasonId}/positions/closed")` |
| `was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesLeverageController.java` | `@RequestMapping("/api/v1/futures")` | `@GetMapping("/leverage")`<br>`@PutMapping("/leverage")` |
| `was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java` | `@RequestMapping("/api/v1/futures")` | `@PostMapping("/order/market/open")`<br>`@PostMapping("/order/market/close")`<br>`@PostMapping("/order/limit/open")`<br>`@PostMapping("/order/limit/close")`<br>`@DeleteMapping("/order/limit/{orderId}")`<br>`@GetMapping("/orders")`<br>`@GetMapping("/positions/open")`<br>`@GetMapping("/positions/closed")` |
| `was/src/main/java/com/yogimangchi/domain/market/controller/v1/MarketController.java` | `@RequestMapping("/api/v1/market")` | `@GetMapping("/spot/symbols")`<br>`@GetMapping("/futures/symbols")` |
| `was/src/main/java/com/yogimangchi/domain/member/controller/v1/AdminMemberController.java` | `@RequestMapping("/api/v1/admin/members")` | `@GetMapping`<br>`@DeleteMapping("/{memberId}")` |
| `was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java` | `@RequestMapping("/api/v1/member/email")` | `@GetMapping("/oauth")`<br>`@PostMapping("/send")`<br>`@PostMapping("/verify")`<br>`@PostMapping("/complete")` |
| `was/src/main/java/com/yogimangchi/domain/member/controller/v1/FavoriteSymbolController.java` | `@RequestMapping("/api/v1/favorites/symbols")` | `@PostMapping("/{symbol}")`<br>`@DeleteMapping("/{symbol}")`<br>`@GetMapping` |
| `was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java` | `@RequestMapping("/api/v1/member")` | `@GetMapping("/{memberId}/followers")`<br>`@GetMapping("/{memberId}/followings")`<br>`@PutMapping("/{targetMemberId}/follows")`<br>`@DeleteMapping("/{targetMemberId}/follows")` |
| `was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java` | `@RequestMapping("/api/v1/member")` | `@GetMapping("/nickname/duplication")`<br>`@GetMapping("/me/info")`<br>`@GetMapping("/{memberId}/info")`<br>`@PatchMapping(value = "/me/info", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)`<br>`@GetMapping("/me/verified-info")`<br>`@PatchMapping("/me/verified-info")`<br>`@DeleteMapping("/me")` |
| `was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java` | `@RequestMapping("/api/v1/notifications")` | `@GetMapping`<br>`@GetMapping("/status")`<br>`@PutMapping("/check")`<br>`@PutMapping("/{notificationId}/read")`<br>`@PutMapping("/read")`<br>`@PutMapping("/read-all")`<br>`@DeleteMapping("/read")`<br>`@DeleteMapping("/{notificationId}")`<br>`@DeleteMapping`<br>`@GetMapping(value = "/subscribe", produces = MediaType.TEXT_EVENT_STREAM_VALUE)` |
| `was/src/main/java/com/yogimangchi/domain/portfolio/controller/v1/PortfolioController.java` | `@RequestMapping("/api/v1/portfolio")` | `@GetMapping("/me")`<br>`@GetMapping("/{memberId}")` |
| `was/src/main/java/com/yogimangchi/domain/real/controller/v1/AssetTransferController.java` | `@RequestMapping("/api/v1/real/assets")` | `@GetMapping("/transfer/history")`<br>`@GetMapping("/transferable")`<br>`@PostMapping("/transfer")` |
| `was/src/main/java/com/yogimangchi/domain/report/controller/v1/MyReportController.java` | `@RequestMapping("/api/v1/me/reports")` | `@GetMapping("/posts")`<br>`@GetMapping("/replys")` |
| `was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java` | `@RequestMapping("/api/v1/community")` | `@PutMapping("/posts/{postId}/reports")`<br>`@DeleteMapping("/posts/{postId}/reports")`<br>`@PutMapping("/posts/{postId}/replys/{replyId}/reports")`<br>`@DeleteMapping("/posts/{postId}/replys/{replyId}/reports")` |
| `was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportTypeController.java` | `@RequestMapping("/api/v1/report")` | `@GetMapping("/type/community")` |
| `was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java` | `@RequestMapping("/api/v1/mock/spot")` | `@PostMapping("/order/market")`<br>`@PostMapping("/order/limit")`<br>`@PutMapping("/orders/{orderId}/cancel")`<br>`@GetMapping("/histories")`<br>`@GetMapping("/orders")`<br>`@GetMapping("/orders/open")` |
| `was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java` | `@RequestMapping("/api/v1/real/spot")` | `@PostMapping("/order/market")`<br>`@PostMapping("/order/limit")`<br>`@PutMapping("/orders/{orderId}/cancel")`<br>`@GetMapping("/histories")`<br>`@GetMapping("/orders")`<br>`@GetMapping("/orders/open")` |

## 누락 탐지 기준

- 전체 TypeScript/TSX 소스 202개, 페이지 27개, API export 130개 중 별도 파일 호출 근거가 있는 export 121개를 색인했다.
- 상수 export와 응답 파서/유틸도 export 목록에 포함되며 모두 사용자 기능이라고 해석하지 않는다.
- 개발용 `/design`, `/test22`, 정적 어드민 메인, 단순 redirect, 준비 중 UI는 완성된 서비스 기능과 분리한다.
- 이름만으로 기능 동등성을 선언하지 않는다. `TradeHistoryTab`은 `FuturesOrderList(mode="trades")`와 완료 주문 API를 재사용한다.
- V1 `useFuturesTradingSession`의 Wallet TODO, 직접 Binance 호출, follower 순위의 게시글 기반 사용자 탐색 등은 그대로 이식하지 않는다.
