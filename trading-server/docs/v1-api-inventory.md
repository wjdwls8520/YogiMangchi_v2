# V1 API 및 Frontend 호출 목록

기준: V1 `main` `a3391b523356d0f44cfec21cb302e326f52b6db3`. 2026-10-20 정적 조사. V1 실행·OAuth·메일·S3 외부 연동은 검증하지 않았다.

이 파일은 누락 방지용 소스 목록이며 V2 Runtime OpenAPI 계약이 아니다. 기능 동등성, 구현 우선순위, 서비스 경계와 검증 시나리오는 [기능 비교표](v1-parity-audit.md)를 따른다. 메서드명과 연결된 Service 구현도 함께 검토했으며 API 선언만으로 제품 동작의 정상 실행을 보장하지 않는다.

## V1 Controller 전체

### MockAssetController

[was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/asset/mock/status` | `getStatus` | [L23](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java#L23) |
| `POST /api/v1/asset/mock/participate` | `participate` | [L33](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java#L33) |
| `POST /api/v1/asset/mock/give-up` | `giveUp` | [L40](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java#L40) |
| `GET /api/v1/asset/mock/portfolio` | `getMyPortfolio` | [L50](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/MockAssetController.java#L50) |

### RealAssetController

[was/src/main/java/com/yogimangchi/domain/asset/controller/v1/RealAssetController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/RealAssetController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/asset/real/detail` | `getUnifiedRealAssetDetail` | [L22](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/asset/controller/v1/RealAssetController.java#L22) |

### AuthController

[was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/auth/signup-info` | `getSignupInfo` | [L34](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java#L34) |
| `POST /api/v1/auth/signup` | `signup` | [L43](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java#L43) |
| `POST /api/v1/auth/refresh` | `refresh` | [L60](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java#L60) |
| `POST /api/v1/auth/logout` | `logout` | [L70](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/auth/controller/v1/AuthController.java#L70) |

### ChartApiController

[was/src/main/java/com/yogimangchi/domain/chartapi/controller/v1/ChartApiController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/chartapi/controller/v1/ChartApiController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/chartapi/prices` | `getTrackedPrices` | [L26](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/chartapi/controller/v1/ChartApiController.java#L26) |
| `GET /api/v1/chartapi/prices/{symbol}` | `getPrice` | [L32](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/chartapi/controller/v1/ChartApiController.java#L32) |
| `GET /api/v1/chartapi/candles/{symbol}` | `getCandles` | [L41](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/chartapi/controller/v1/ChartApiController.java#L41) |

### ChartistController

[was/src/main/java/com/yogimangchi/domain/chartist/controller/v1/ChartistController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/chartist/controller/v1/ChartistController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/chartist/seasons/{seasonId}/results` | `getChartistResults` | [L33](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/chartist/controller/v1/ChartistController.java#L33) |

### AdminCommunityController

[was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/admin/community/posts` | `getPosts` | [L43](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L43) |
| `GET /api/v1/admin/community/posts/withdrawn-author` | `getWithdrawnAuthorPosts` | [L54](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L54) |
| `GET /api/v1/admin/community/posts/active-author` | `getActiveAuthorPosts` | [L65](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L65) |
| `DELETE /api/v1/admin/community/posts/{postId}` | `deletePostByAdmin` | [L76](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L76) |
| `GET /api/v1/admin/community/replies` | `getReplies` | [L90](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L90) |
| `GET /api/v1/admin/community/replies/withdrawn-author` | `getWithdrawnAuthorReplies` | [L101](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L101) |
| `GET /api/v1/admin/community/replies/active-author` | `getActiveAuthorReplies` | [L112](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L112) |
| `DELETE /api/v1/admin/community/replies/{replyId}` | `deleteReplyByAdmin` | [L123](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/AdminCommunityController.java#L123) |

### CommunityUxController

[was/src/main/java/com/yogimangchi/domain/community/controller/v1/CommunityUxController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/CommunityUxController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/community/ux/subscribe/feed` | `subscribeFeed` | [L25](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/CommunityUxController.java#L25) |

### LikeController

[was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `PUT /api/v1/community/posts/{postId}/likes` | `likePost` | [L26](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java#L26) |
| `DELETE /api/v1/community/posts/{postId}/likes` | `unlikePost` | [L39](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java#L39) |
| `PUT /api/v1/community/posts/{postId}/replys/{replyId}/likes` | `likeReply` | [L52](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java#L52) |
| `DELETE /api/v1/community/posts/{postId}/replys/{replyId}/likes` | `unlikeReply` | [L66](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/LikeController.java#L66) |

### MyCommunityController

[was/src/main/java/com/yogimangchi/domain/community/controller/v1/MyCommunityController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/MyCommunityController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/me/community/liked-posts` | `getLikedPosts` | [L33](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/MyCommunityController.java#L33) |
| `GET /api/v1/me/community/liked-replys` | `getLikedReplys` | [L47](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/MyCommunityController.java#L47) |

### PostController

[was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/community/posts` | `getPosts` | [L36](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java#L36) |
| `GET /api/v1/community/member/{memberId}/posts` | `getPostsByAuthor` | [L50](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java#L50) |
| `GET /api/v1/community/posts/{postId}` | `getPost` | [L69](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java#L69) |
| `POST /api/v1/community/posts` | `createPost` | [L83](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java#L83) |
| `PUT /api/v1/community/posts/{postId}` | `updatePost` | [L100](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java#L100) |
| `DELETE /api/v1/community/posts/{postId}` | `deletePost` | [L122](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/PostController.java#L122) |

### ReplyController

[was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/community/posts/{postId}/replys` | `getParentReplys` | [L33](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java#L33) |
| `GET /api/v1/community/member/{memberId}/replys` | `getReplysByAuthor` | [L47](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java#L47) |
| `POST /api/v1/community/posts/{postId}/replys` | `createReply` | [L66](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java#L66) |
| `PUT /api/v1/community/posts/{postId}/replys` | `updateReply` | [L84](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java#L84) |
| `DELETE /api/v1/community/posts/{postId}/replys` | `deleteReply` | [L100](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/community/controller/v1/ReplyController.java#L100) |

### AdminContestController

[was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `POST /api/v1/admin/contest/seasons` | `createContest` | [L39](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L39) |
| `PUT /api/v1/admin/contest/seasons/{seasonId}` | `updateContestSeason` | [L53](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L53) |
| `PATCH /api/v1/admin/contest/seasons/{seasonId}/status` | `updateContestSeasonStatus` | [L68](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L68) |
| `GET /api/v1/admin/contest/seasons/{seasonId}/applicants` | `getContestApplicants` | [L83](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L83) |
| `POST /api/v1/admin/contest/seasons/{seasonId}/applicants/{applicantId}/approve` | `approveContestApplicant` | [L102](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L102) |
| `POST /api/v1/admin/contest/seasons/{seasonId}/applicants/{applicantId}/reject` | `rejectContestApplicant` | [L120](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L120) |
| `GET /api/v1/admin/contest/seasons/{seasonId}/participants` | `getContestParticipants` | [L140](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L140) |
| `GET /api/v1/admin/contest/seasons/{seasonId}/rejected-applicants` | `getRejectedContestApplicants` | [L159](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L159) |
| `GET /api/v1/admin/contest/seasons` | `getContestSeasons` | [L178](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L178) |
| `POST /api/v1/admin/contest/seasons/{seasonId}/settlement` | `settleContestSeason` | [L194](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/AdminContestController.java#L194) |

### ContestController

[was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/contest/seasons/statuses` | `getContestSeasonStatuses` | [L42](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java#L42) |
| `GET /api/v1/contest/seasons/recruiting` | `getApplicableContestSeasons` | [L53](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java#L53) |
| `GET /api/v1/contest/member/{memberId}/participation-seasons` | `getMemberContestParticipationSeasons` | [L72](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java#L72) |
| `POST /api/v1/contest/seasons/{seasonId}/applications` | `applyContestSeason` | [L91](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java#L91) |
| `GET /api/v1/contest/seasons/{seasonId}/results` | `getContestResults` | [L110](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java#L110) |
| `GET /api/v1/contest/seasons/{seasonId}/members/{memberId}/result` | `getMemberContestResult` | [L124](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/ContestController.java#L124) |

### MyContestController

[was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/me/contest/pending-applications` | `getMyPendingContestApplications` | [L37](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java#L37) |
| `GET /api/v1/me/contest/participating-seasons` | `getMyParticipatingContestSeasons` | [L52](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java#L52) |
| `GET /api/v1/me/contest/rejected-applications/latest` | `getMyLatestRejectedContestApplication` | [L67](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java#L67) |
| `GET /api/v1/me/contest/seasons/{seasonId}/result` | `getMyContestSeasonResult` | [L93](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/MyContestController.java#L93) |

### PublicContestController

[was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/contest/public/recruiting` | `getRecruitingContestSeasons` | [L35](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java#L35) |
| `GET /api/v1/contest/public/running` | `getRunningContestSeasons` | [L47](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java#L47) |
| `GET /api/v1/contest/public/finished` | `getFinishedContestSeasons` | [L59](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java#L59) |
| `GET /api/v1/contest/public/seasons/{seasonId}/results` | `getContestResults` | [L72](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java#L72) |
| `GET /api/v1/contest/public/seasons/latest-finished/results` | `getLatestFinishedContestResults` | [L86](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/contest/controller/v1/PublicContestController.java#L86) |

### ContestFuturesAssetController

[was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesAssetController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesAssetController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/futures/contest/{contestSeasonId}/wallet/status` | `getContestWalletStatus` | [L27](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesAssetController.java#L27) |
| `GET /api/v1/futures/contest/{contestSeasonId}/wallet/status/finished` | `getFinishedContestWalletStatus` | [L47](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesAssetController.java#L47) |

### ContestFuturesLeverageController

[was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesLeverageController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesLeverageController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/futures/contest/{contestSeasonId}/leverage` | `getLeverage` | [L30](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesLeverageController.java#L30) |
| `PUT /api/v1/futures/contest/{contestSeasonId}/leverage` | `setLeverage` | [L54](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesLeverageController.java#L54) |

### ContestFuturesOrderController

[was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `POST /api/v1/futures/contest/{contestSeasonId}/order/market/open` | `placeMarketOrderOpen` | [L41](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L41) |
| `POST /api/v1/futures/contest/{contestSeasonId}/order/market/close` | `placeMarketOrderClose` | [L53](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L53) |
| `POST /api/v1/futures/contest/{contestSeasonId}/order/limit/open` | `placeLimitOrderOpen` | [L65](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L65) |
| `POST /api/v1/futures/contest/{contestSeasonId}/order/limit/close` | `placeLimitOrderClose` | [L77](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L77) |
| `DELETE /api/v1/futures/contest/{contestSeasonId}/order/limit/{orderId}` | `cancelLimitOrder` | [L89](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L89) |
| `GET /api/v1/futures/contest/{contestSeasonId}/orders` | `getOrders` | [L102](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L102) |
| `GET /api/v1/futures/contest/{contestSeasonId}/positions/open` | `getOpenPositions` | [L114](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L114) |
| `GET /api/v1/futures/contest/{contestSeasonId}/positions/closed` | `getClosedPositions` | [L126](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/ContestFuturesOrderController.java#L126) |

### FuturesLeverageController

[was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesLeverageController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesLeverageController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/futures/leverage` | `getLeverage` | [L30](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesLeverageController.java#L30) |
| `PUT /api/v1/futures/leverage` | `setLeverage` | [L53](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesLeverageController.java#L53) |

### FuturesOrderController

[was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `POST /api/v1/futures/order/market/open` | `placeMarketOrderOpen` | [L41](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L41) |
| `POST /api/v1/futures/order/market/close` | `placeMarketOrderClose` | [L52](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L52) |
| `POST /api/v1/futures/order/limit/open` | `placeLimitOrderOpen` | [L63](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L63) |
| `POST /api/v1/futures/order/limit/close` | `placeLimitOrderClose` | [L74](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L74) |
| `DELETE /api/v1/futures/order/limit/{orderId}` | `cancelLimitOrder` | [L85](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L85) |
| `GET /api/v1/futures/orders` | `getOrders` | [L97](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L97) |
| `GET /api/v1/futures/positions/open` | `getOpenPositions` | [L108](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L108) |
| `GET /api/v1/futures/positions/closed` | `getClosedPositions` | [L119](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/futures/controller/FuturesOrderController.java#L119) |

### MarketController

[was/src/main/java/com/yogimangchi/domain/market/controller/v1/MarketController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/market/controller/v1/MarketController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/market/spot/symbols` | `getSpotSymbols` | [L25](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/market/controller/v1/MarketController.java#L25) |
| `GET /api/v1/market/futures/symbols` | `getFutureSymbols` | [L32](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/market/controller/v1/MarketController.java#L32) |

### AdminMemberController

[was/src/main/java/com/yogimangchi/domain/member/controller/v1/AdminMemberController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/AdminMemberController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/admin/members` | `getMembers` | [L35](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/AdminMemberController.java#L35) |
| `DELETE /api/v1/admin/members/{memberId}` | `withdrawMemberByAdmin` | [L59](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/AdminMemberController.java#L59) |

### EmailVerificationController

[was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/member/email/oauth` | `getOAuthEmail` | [L32](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java#L32) |
| `POST /api/v1/member/email/send` | `sendVerificationCode` | [L56](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java#L56) |
| `POST /api/v1/member/email/verify` | `verifyCode` | [L75](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java#L75) |
| `POST /api/v1/member/email/complete` | `completeVerification` | [L103](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/EmailVerificationController.java#L103) |

### FavoriteSymbolController

[was/src/main/java/com/yogimangchi/domain/member/controller/v1/FavoriteSymbolController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FavoriteSymbolController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `POST /api/v1/favorites/symbols/{symbol}` | `addFavorite` | [L26](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FavoriteSymbolController.java#L26) |
| `DELETE /api/v1/favorites/symbols/{symbol}` | `removeFavorite` | [L39](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FavoriteSymbolController.java#L39) |
| `GET /api/v1/favorites/symbols` | `getFavorites` | [L52](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FavoriteSymbolController.java#L52) |

### FollowController

[was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/member/{memberId}/followers` | `getFollowerMembers` | [L38](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java#L38) |
| `GET /api/v1/member/{memberId}/followings` | `getFollowingMembers` | [L53](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java#L53) |
| `PUT /api/v1/member/{targetMemberId}/follows` | `followMember` | [L68](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java#L68) |
| `DELETE /api/v1/member/{targetMemberId}/follows` | `unfollowMember` | [L82](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/FollowController.java#L82) |

### MemberController

[was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/member/nickname/duplication` | `isAvailableNickname` | [L44](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L44) |
| `GET /api/v1/member/me/info` | `getMemberInfoMe` | [L56](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L56) |
| `GET /api/v1/member/{memberId}/info` | `getMemberInfo` | [L70](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L70) |
| `PATCH /api/v1/member/me/info` | `updateMemberInfoMe` | [L84](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L84) |
| `GET /api/v1/member/me/verified-info` | `getVerifiedInfo` | [L104](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L104) |
| `PATCH /api/v1/member/me/verified-info` | `updateVerifiedInfo` | [L116](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L116) |
| `DELETE /api/v1/member/me` | `withdrawMember` | [L129](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/member/controller/v1/MemberController.java#L129) |

### NotificationController

[was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/notifications` | `getNotifications` | [L45](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L45) |
| `GET /api/v1/notifications/status` | `getStatus` | [L57](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L57) |
| `PUT /api/v1/notifications/check` | `checkNotifications` | [L68](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L68) |
| `PUT /api/v1/notifications/{notificationId}/read` | `markAsRead` | [L80](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L80) |
| `PUT /api/v1/notifications/read` | `markSelectedAsRead` | [L93](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L93) |
| `PUT /api/v1/notifications/read-all` | `markReadAll` | [L106](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L106) |
| `DELETE /api/v1/notifications/read` | `deleteReadNotifications` | [L118](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L118) |
| `DELETE /api/v1/notifications/{notificationId}` | `deleteNotification` | [L130](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L130) |
| `DELETE /api/v1/notifications` | `deleteNotifications` | [L143](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L143) |
| `GET /api/v1/notifications/subscribe` | `subscribe` | [L156](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/notification/controller/v1/NotificationController.java#L156) |

### PortfolioController

[was/src/main/java/com/yogimangchi/domain/portfolio/controller/v1/PortfolioController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/portfolio/controller/v1/PortfolioController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/portfolio/me` | `getMyProfilePortfolio` | [L32](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/portfolio/controller/v1/PortfolioController.java#L32) |
| `GET /api/v1/portfolio/{memberId}` | `getMemberPortfolio` | [L51](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/portfolio/controller/v1/PortfolioController.java#L51) |

### AssetTransferController

[was/src/main/java/com/yogimangchi/domain/real/controller/v1/AssetTransferController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/real/controller/v1/AssetTransferController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/real/assets/transfer/history` | `getTransferHistories` | [L37](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/real/controller/v1/AssetTransferController.java#L37) |
| `GET /api/v1/real/assets/transferable` | `getTransferableAmount` | [L51](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/real/controller/v1/AssetTransferController.java#L51) |
| `POST /api/v1/real/assets/transfer` | `transferAsset` | [L65](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/real/controller/v1/AssetTransferController.java#L65) |

### MyReportController

[was/src/main/java/com/yogimangchi/domain/report/controller/v1/MyReportController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/MyReportController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/me/reports/posts` | `getReportedPosts` | [L33](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/MyReportController.java#L33) |
| `GET /api/v1/me/reports/replys` | `getReportedReplys` | [L47](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/MyReportController.java#L47) |

### ReportController

[was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `PUT /api/v1/community/posts/{postId}/reports` | `reportPost` | [L25](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java#L25) |
| `DELETE /api/v1/community/posts/{postId}/reports` | `unreportPost` | [L39](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java#L39) |
| `PUT /api/v1/community/posts/{postId}/replys/{replyId}/reports` | `reportReply` | [L52](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java#L52) |
| `DELETE /api/v1/community/posts/{postId}/replys/{replyId}/reports` | `unreportReply` | [L67](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportController.java#L67) |

### ReportTypeController

[was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportTypeController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportTypeController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `GET /api/v1/report/type/community` | `getResponseReportTypeByCommunity` | [L25](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/report/controller/v1/ReportTypeController.java#L25) |

### MockSpotOrderController

[was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `POST /api/v1/mock/spot/order/market` | `createMarketOrder` | [L45](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java#L45) |
| `POST /api/v1/mock/spot/order/limit` | `createLimitOrder` | [L57](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java#L57) |
| `PUT /api/v1/mock/spot/orders/{orderId}/cancel` | `cancelOrder` | [L69](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java#L69) |
| `GET /api/v1/mock/spot/histories` | `getTradeHistories` | [L84](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java#L84) |
| `GET /api/v1/mock/spot/orders` | `getOrders` | [L100](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java#L100) |
| `GET /api/v1/mock/spot/orders/open` | `getOpenOrders` | [L115](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/MockSpotOrderController.java#L115) |

### RealSpotOrderController

[was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java)

| API | 업무 메서드 | 코드 |
|---|---|---|
| `POST /api/v1/real/spot/order/market` | `createMarketOrder` | [L45](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java#L45) |
| `POST /api/v1/real/spot/order/limit` | `createLimitOrder` | [L57](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java#L57) |
| `PUT /api/v1/real/spot/orders/{orderId}/cancel` | `cancelOrder` | [L69](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java#L69) |
| `GET /api/v1/real/spot/histories` | `getTradeHistories` | [L84](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java#L84) |
| `GET /api/v1/real/spot/orders` | `getOrders` | [L100](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java#L100) |
| `GET /api/v1/real/spot/orders/open` | `getOpenOrders` | [L115](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/was/src/main/java/com/yogimangchi/domain/spot/controller/v1/RealSpotOrderController.java#L115) |

## Frontend API 함수와 실제 소비자

아래 소비자는 해당 API 모듈을 import하는 화면·Hook이다. 모듈 내 모든 함수가 실제 실행된다는 뜻은 아니다. 직접 fetch/SSE/시장 데이터 호출은 별도 항목을 따른다.

### admin-community.ts

[web/lib/api/admin-community.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/admin-community.ts)

- 함수: `getAdminPosts` (L61), `deletePostByAdmin` (L97), `getAdminReplies` (L104), `deleteReplyByAdmin` (L143)
- 소비자: [web/app/(admin)/admin/community/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/community/page.tsx); [web/app/(admin)/admin/community/components/PostDetailModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/community/components/PostDetailModal.tsx); [web/app/(admin)/admin/community/components/ReplyDetailModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/community/components/ReplyDetailModal.tsx)

### admin-contest.ts

[web/lib/api/admin-contest.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/admin-contest.ts)

- 함수: `createContestSeason` (L91), `getAdminContestSeasons` (L107), `getAdminContestSeasonById` (L132), `updateContestSeason` (L153), `updateContestSeasonStatus` (L170), `getContestApplicants` (L181), `getContestParticipants` (L209), `getRejectedContestApplicants` (L237), `approveContestApplicant` (L267), `rejectContestApplicant` (L280), `settleContestSeason` (L297)
- 소비자: [web/app/(admin)/admin/contest/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/page.tsx); [web/app/(admin)/admin/contest/components/ContestCreateModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/components/ContestCreateModal.tsx); [web/app/(admin)/admin/contest/components/ContestEditModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/components/ContestEditModal.tsx); [web/app/(admin)/admin/contest/components/ContestMembersManager.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/components/ContestMembersManager.tsx); [web/app/(admin)/admin/contest/[seasonId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/%5BseasonId%5D/page.tsx)

### admin-member.ts

[web/lib/api/admin-member.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/admin-member.ts)

- 함수: `getAdminMembers` (L33), `withdrawMemberByAdmin` (L62)
- 소비자: [web/app/(admin)/admin/users/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/users/page.tsx); [web/app/(admin)/admin/users/components/UserDetailModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/users/components/UserDetailModal.tsx)

### asset.ts

[web/lib/api/asset.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/asset.ts)

- 함수: `getUnifiedRealAssetDetail` (L82), `getMySpotPortfolio` (L91)
- 소비자: [web/app/(default)/assets/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/assets/page.tsx); [web/app/(default)/me/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/page.tsx); [web/app/(default)/member/[memberId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/member/%5BmemberId%5D/page.tsx)

### client.ts

[web/lib/api/client.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/client.ts)

- 함수: `fetchClient` (L51)
- 소비자: [web/app/(default)/assets/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/assets/page.tsx); [web/app/(default)/community/components/WriteModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/WriteModal.tsx); [web/app/(default)/community/components/comment/CommentForm.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/comment/CommentForm.tsx); [web/app/(default)/me/settings/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/settings/page.tsx); [web/app/(full)/verify/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28full%29/verify/page.tsx); [web/components/asset/AssetTransferModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/asset/AssetTransferModal.tsx); [web/hooks/useContestFuturesTradingSession.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/hooks/useContestFuturesTradingSession.ts); [web/stores/useMarketStore.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/stores/useMarketStore.ts); [web/stores/useMockWalletStore.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/stores/useMockWalletStore.ts)

### community-ux.ts

[web/lib/api/community-ux.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/community-ux.ts)

- 함수: `COMMUNITY_UX_POST_CREATED_EVENT` (L9), `subscribeCommunityFeed` (L11), `isPostCreatedUxEvent` (L17)
- 소비자: [web/app/(default)/community/components/CommunityContainer.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/CommunityContainer.tsx)

### contest-futures.ts

[web/lib/api/contest-futures.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/contest-futures.ts)

- 함수: `getFuturesWalletStatus` (L170), `getFinishedContestWalletStatus` (L186), `getContestFuturesOpenPositions` (L203), `getContestFuturesClosedPositions` (L216), `getContestFuturesOrders` (L229), `getContestFuturesLeverage` (L242), `updateContestFuturesLeverage` (L264), `placeContestFuturesOpenMarketOrder` (L282), `placeContestFuturesOpenLimitOrder` (L301), `placeContestFuturesCloseMarketOrder` (L328), `placeContestFuturesCloseLimitOrder` (L347), `cancelContestFuturesLimitOrder` (L374)
- 소비자: [web/app/(default)/assets/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/assets/page.tsx); [web/app/(default)/me/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/page.tsx); [web/app/(default)/member/[memberId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/member/%5BmemberId%5D/page.tsx); [web/components/futures/trading/ClosedPositionsTab.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/futures/trading/ClosedPositionsTab.tsx); [web/components/futures/trading/FuturesOrderList.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/futures/trading/FuturesOrderList.tsx); [web/hooks/useContestFuturesTradingSession.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/hooks/useContestFuturesTradingSession.ts)

### contest.ts

[web/lib/api/contest.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/contest.ts)

- 함수: `translateContestDisplayStatus` (L117), `inferContestIsPublic` (L141), `inferContestIsCanceled` (L152), `getRecruitingContestSeasons` (L164), `getPublishedContestSeasons` (L175), `getFinishedContestSeasons` (L182), `applyContestSeason` (L189), `getContestSeasonStatuses` (L196), `getContestParticipationSeasonsByMember` (L203), `getMyParticipatingContestSeasons` (L216), `getMyPendingContestApplications` (L226), `getMyLatestRejectedContestApplication` (L236), `getMyContestSeasonResult` (L255), `getMemberContestSeasonResult` (L272), `getContestResults` (L289), `getPublicContestResults` (L299), `getLatestFinishedContestResults` (L309)
- 소비자: [web/app/(admin)/admin/contest/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/page.tsx); [web/app/(admin)/admin/contest/components/ContestCreateModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/components/ContestCreateModal.tsx); [web/app/(admin)/admin/contest/components/ContestEditModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/components/ContestEditModal.tsx); [web/app/(admin)/admin/contest/[seasonId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28admin%29/admin/contest/%5BseasonId%5D/page.tsx); [web/app/(default)/assets/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/assets/page.tsx); [web/app/(default)/community/components/Top5Wrapper.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/Top5Wrapper.tsx); [web/app/(default)/me/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/page.tsx); [web/app/(default)/member/[memberId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/member/%5BmemberId%5D/page.tsx); [web/app/(default)/rank/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/rank/page.tsx); [web/app/(trade-full)/contest/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28trade-full%29/contest/page.tsx); [web/components/contest/ContestDetailModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/contest/ContestDetailModal.tsx); [web/components/contest/trading/ContestTradingHero.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/contest/trading/ContestTradingHero.tsx); [web/components/user/profile/ProfileContestHistorySection.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/user/profile/ProfileContestHistorySection.tsx); [web/hooks/useContestFuturesTradingSession.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/hooks/useContestFuturesTradingSession.ts)

### favorite.ts

[web/lib/api/favorite.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/favorite.ts)

- 함수: `getFavorites` (L3), `addFavorite` (L19), `removeFavorite` (L25)
- 소비자: [web/stores/useFavoriteStore.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/stores/useFavoriteStore.ts)

### futures.ts

[web/lib/api/futures.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/futures.ts)

- 함수: `getRealFuturesWalletBalance` (L154), `getFuturesOpenPositions` (L166), `getFuturesClosedPositions` (L175), `getFuturesOrders` (L184), `getFuturesLeverage` (L193), `updateFuturesLeverage` (L212), `placeFuturesOpenMarketOrder` (L229), `placeFuturesOpenLimitOrder` (L244), `placeFuturesCloseMarketOrder` (L267), `placeFuturesCloseLimitOrder` (L282), `cancelFuturesLimitOrder` (L305)
- 소비자: [web/app/(default)/assets/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/assets/page.tsx); [web/components/futures/trading/ClosedPositionsTab.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/futures/trading/ClosedPositionsTab.tsx); [web/components/futures/trading/FuturesOrderList.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/futures/trading/FuturesOrderList.tsx); [web/hooks/useFuturesTradingSession.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/hooks/useFuturesTradingSession.ts); [web/hooks/useRealTradingQuest.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/hooks/useRealTradingQuest.ts)

### me-community.ts

[web/lib/api/me-community.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/me-community.ts)

- 함수: `getMemberPosts` (L38), `getMemberReplies` (L48), `getLikedPosts` (L58), `getLikedReplies` (L69), `getReportedPosts` (L80), `getReportedReplies` (L91), `cancelReportedPost` (L102), `cancelReportedReply` (L109)
- 소비자: [web/app/(default)/me/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/page.tsx); [web/app/(default)/member/[memberId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/member/%5BmemberId%5D/page.tsx)

### member.ts

[web/lib/api/member.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/member.ts)

- 함수: `getMemberInfo` (L68), `getMyMemberInfo` (L73), `getMyMemberProfile` (L78), `getMyVerifiedInfo` (L83), `updateMyProfileInfo` (L88), `getOAuthEmail` (L126), `sendEmailVerificationCode` (L131), `verifyEmailVerificationCode` (L139), `completeMemberVerification` (L150), `updateMyVerifiedInfo` (L160), `followMember` (L211), `unfollowMember` (L218), `getMemberFollowers` (L225), `getMemberFollowings` (L238)
- 소비자: [web/app/(default)/community/components/Top5.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/Top5.tsx); [web/app/(default)/community/components/Top5Wrapper.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/Top5Wrapper.tsx); [web/app/(default)/me/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/page.tsx); [web/app/(default)/me/settings/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/me/settings/page.tsx); [web/app/(default)/member/[memberId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/member/%5BmemberId%5D/page.tsx); [web/app/(default)/rank/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/rank/page.tsx); [web/app/(full)/signup/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28full%29/signup/page.tsx); [web/app/(full)/verify/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28full%29/verify/page.tsx); [web/components/user/profile/FollowMembersModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/user/profile/FollowMembersModal.tsx)

### notifications.ts

[web/lib/api/notifications.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/notifications.ts)

- 함수: `subscribeNotifications` (L8), `getNotifications` (L14), `checkNotifications` (L33), `readAllNotifications` (L39), `readNotification` (L45), `readSelectedNotifications` (L51), `deleteSelectedNotifications` (L60), `deleteReadNotifications` (L69)
- 소비자: [web/app/SSEProvider.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/SSEProvider.tsx); [web/components/Header.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/Header.tsx); [web/components/notifications/NotificationsPageView.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/notifications/NotificationsPageView.tsx)

### portfolio.ts

[web/lib/api/portfolio.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/portfolio.ts)

- 함수: `getMyProfilePortfolio` (L21), `getMemberPortfolio` (L28)
- 소비자: [web/app/(default)/member/[memberId]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/member/%5BmemberId%5D/page.tsx)

### post.server.ts

[web/lib/api/post.server.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/post.server.ts)

- 함수: `getPostsServer` (L6), `getPostServer` (L13), `getReplysServer` (L20)
- 소비자: [web/app/(default)/community/[category]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/%5Bcategory%5D/page.tsx); [web/app/(default)/community/[category]/[id]/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/%5Bcategory%5D/%5Bid%5D/page.tsx)

### post.ts

[web/lib/api/post.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/post.ts)

- 함수: `createPost` (L24), `getPosts` (L34), `getPost` (L47), `putPost` (L54), `putLike` (L64), `deleteLike` (L72), `deletePost` (L81), `reportPost` (L88), `unreportPost` (L102), `getReplys` (L111), `createReply` (L133), `putReply` (L142), `putReplyLike` (L158), `deleteReplyLike` (L166), `deleteReply` (L176), `reportReply` (L190), `unreportReply` (L206), `getReportEnum` (L215)
- 소비자: [web/app/(default)/community/components/CommunityContainer.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/CommunityContainer.tsx); [web/app/(default)/community/components/CommunityItem.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/CommunityItem.tsx); [web/app/(default)/community/components/CommunityList.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/CommunityList.tsx); [web/app/(default)/community/components/ReportModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/ReportModal.tsx); [web/app/(default)/community/components/WriteModal.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/WriteModal.tsx); [web/app/(default)/community/components/comment/CommentContainer.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/comment/CommentContainer.tsx); [web/app/(default)/community/components/comment/CommentForm.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/community/components/comment/CommentForm.tsx); [web/app/(default)/rank/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/rank/page.tsx); [web/app/(main)/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28main%29/page.tsx)

### server.ts

[web/lib/api/server.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/server.ts)

- 함수: `serverFetchClient` (L3)
- 소비자: **직접 import 미발견: 사용 여부 UNVERIFIED**

### trade.ts

[web/lib/api/trade.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/lib/api/trade.ts)

- 함수: `placeMarketOrder` (L188), `placeLimitOrder` (L201), `fetchOrders` (L214), `fetchOpenOrders` (L225), `fetchTradeHistories` (L236), `fetchRealSpotAssetDetail` (L247), `cancelOrder` (L253), `buildTradeQueryParams` (L265), `extractApiMessage` (L302), `parseCursorResponse` (L329)
- 소비자: [web/app/(default)/assets/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28default%29/assets/page.tsx); [web/app/(trade-full)/trading/page.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/app/%28trade-full%29/trading/page.tsx); [web/components/trade/OrderForm.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/trade/OrderForm.tsx); [web/components/trade/UserOrderHistory.tsx](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/components/trade/UserOrderHistory.tsx); [web/hooks/useRealTradingQuest.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/hooks/useRealTradingQuest.ts); [web/stores/useMockWalletStore.ts](https://github.com/wjdwls8520/YogiMangchi/blob/a3391b523356d0f44cfec21cb302e326f52b6db3/web/stores/useMockWalletStore.ts)

## Controller 밖 흐름

- OAuth redirect/login: `global/config/SecurityConfig.java`, `global/auth/oauth/handler/OAuth2SuccessHandler.java`; `web/app/(full)/login/page.tsx`, `web/app/(full)/signup/page.tsx`, `web/app/AuthBootstrap.tsx`.
- 이메일 인증 완료와 거래 해금: `member/service/EmailVerificationService.java`, `UserQuestService.java`; `web/hooks/useRealTradingQuest.ts`, `web/components/quest/*`, `web/app/(full)/verify/page.tsx`.
- 시세 직접 연결: `web/hooks/useBinanceWebSocket.ts`, `useBinanceTickers.ts`; V2 이식에서 Browser→Binance 경로를 복제하지 않는다.
- 개인 SSE: `web/app/SSEProvider.tsx`, `web/lib/utils/notification-sse.ts`; 커뮤니티 피드 SSE는 `web/lib/api/community-ux.ts`.
- 회원 탈퇴 청크: `member/service/MemberWithdrawChunkExecutor.java`, `member/event/MemberWithdrawListener.java`; 대회 자동 종료: `contest/service/ContestSettlementScheduler.java`.

## 조사 범위와 한계

- Controller 34개, 명시된 HTTP 메서드 142개. 도메인별: asset 5, auth 4, chartapi 3, chartist 1, community 26, contest 25, futures 22, market 2, member 20, notification 10, portfolio 2, real 3, report 7, spot 12.
- Controller 전체의 경로/업무 메서드와 Frontend API 모듈 전체를 대조했다. 기능 비교표의 Service/Entity/Repository 근거를 함께 사용한다.
- V1은 실행하지 않았으며 실서비스 정상 동작·외부 Provider·배포 설정까지 확인한 전수 검증이 아니다. 코드가 없는 기능은 추정하여 이식 완료로 표시하지 않는다.
- V1 문서보다 실제 코드가 최신인 사례: login.md에는 refresh/logout이 미구현이라고 적혀 있으나 AuthController/AuthService에는 구현돼 있다.
- `web/lib/api/asset.ts:getMySpotPortfolio`의 `asset/real/spot`은 현재 Controller 대응 경로가 없어 UNVERIFIED다.
- Funding Fee/TP-SL/뉴스의 업무 구현 근거는 발견하지 못했다. V2 신규 기획과 V1 필수 이식을 구분한다.
