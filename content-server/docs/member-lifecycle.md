# 회원 탈퇴·재가입·동의 및 최초 계정 생성

이번 변경은 Content/Trading Backend만 담당한다. 커뮤니티·이미지 업로드·Frontend·루트 인프라는 구현/변경하지 않는다.

## 프론트엔드 계약

1. `GET /api/v1/policies/current`의 각 `documentUrl`을 조회해 text/version/sha256을 표시한다. 현재 문서는 DEVELOPMENT_DRAFT다.
2. 기존 OAuth 가입 흐름에서 nickname,termAgree=true,privateAgree=true,termsVersion=ym-terms-v1,privacyVersion=ym-privacy-v1을 보낸다.
   profileMessage는 선택이다. 세션 쿠키+CSRF가 필요하다. 버전 누락400, 오래된 버전409. 동시/재전송 가입은 중복 계정을 만들지 않는다.
   가입 응답 유실 후에는 OAuth flow를 다시 확인하여 LOGIN_READY로 로그인한다. 이력/자금을 새로 합치지 않는다.
3. 로그인 후 `GET /api/v1/members/me/consents`(Bearer)를 읽는다. policies의 required/accepted/lastAcceptedVersion/lastAgreedAt과 reconsentRequired를 사용한다.
4. `POST` 같은 경로에 termAgree/privateAgree와 현재 두 버전을 보낸다. 서버 시각으로 append하며 같은 버전 동의는 중복 저장·시각 갱신하지 않는다.
   현재는 재동의 필요 상태/제출을 제공하며 모든 업무를 일괄 차단하는 새로운 서비스 정책은 도입하지 않았다.
5. 탈퇴 시 현재 회원 Bearer를 유지한 채 Google/Kakao 인증을 다시 수행하여 **같은 회원**의5분 증명 세션을 얻는다.
   `/api/v1/auth/login/complete`로 증명을 소비하지 말고 `/api/v1/auth/csrf`를 credentials:include로 호출한다.
6. `POST /api/v1/members/me/withdrawal`에 Bearer, 세션 쿠키, 반환된 CSRF 헤더와 아래 JSON을 보낸다.

```json
{"acknowledged":true,"confirmation":"탈퇴합니다","policyVersion":"ym-withdrawal-v1"}
```

안내: 계정 복구 불가, 일반 개인정보/소셜 연결 제거, 같은 소셜 재가입은 새 ID, 이전 자산/기록 이전 불가,
미체결 주문 취소, 열린 포지션 관리상 종료, 향후 게시글/댓글 본문 보존·작성자 탈퇴한회원 표시, 필요한 거래 원장 보존.
이 확인은 서비스 의사 확인이며 공인 전자서명이라는 의미가 아니다. JWT sub 이외 body memberId는 신뢰하지 않는다.

응답202 `{status:"PENDING"}`은 접수이며 탈퇴 확정이 아니다. Refresh 쿠키/요청 세션은 비우고 모든 Refresh를 폐기한다.
기존 Access로 `GET` 동일 경로에서 `{status:"PENDING"|"COMPLETED"|"NOT_REQUESTED"}`만 조회할 수 있다.
POST 반복에는 새 CSRF와 올바른 확인 본문이 필요하나 이미 접수된 요청은 새 OAuth 증명을 요구하지 않는다.
Access 만료 뒤에도 서버 재전송은 계속된다. 새 OAuth flow가 WITHDRAWAL_PENDING이면 가입/로그인을 진행하지 않고 기다린다.
완료 후에는 SIGNUP_REQUIRED이며 새 동의·닉네임으로 새 ID를 만든다. 기존 W 계정은 재활성화하지 않는다.

## 차단 및 개인정보

Content는 ACTIVE→WITHDRAWING부터 기존 JWT 회원 기능·Refresh/로그인·팔로우/프로필 접근을 차단한다.
Trading 차단은 전용 요청을 받아 동일 계정 DB 잠금 아래 주문 취소·포지션 정리·WITHDRAWN을 커밋한 순간이다.
그 이전에 이미 잠금을 획득한 거래는 먼저 커밋할 수 있다. 네트워크 전달 전까지를 분산 원자성으로 포장하지 않는다.
Content가 WITHDRAWN/COMPLETED를 확정하는 시점에는 Trading 차단/정리가 반드시 이미 커밋되어 있다.
Trading 후 Content 커밋 실패 시 Trading은 계속 차단하고 Content는 PENDING으로 재전송하여 복구한다.

최종 Content Transaction: nickname NULL, profileMessage 빈 값, 기존 동의 시각 NULL,
OAuthIdentity(이메일·provider·subject) 물리 파기, RefreshSession 해시/계열 물리 파기, 불필요한 버전 동의 이력 파기.
이는 개인정보/보안 데이터 파기이며 Member·Follow·Order·Fill·Position 업무 이력의 물리 삭제가 아니다.
Member ID/status/createdAt/withdrawnAt, 최소 withdrawal 확인 버전/시각과 서비스 전송 상태는 보존한다.
현재 실제 프로필 이미지·외부 파일·뉴스/커뮤니티/멘션 테이블은 없으므로 이번에 삭제/익명화한 것으로 주장하지 않는다.
향후 멘션은 memberId로 연결하며 탈퇴한회원은 표시 이름이다. 식별 불가능한 과거 텍스트를 일괄 치환하지 않는다.

## 약관 버전과 운영 전 확정

policy_version은 문서 종류별 current 하나와 required를 관리한다. 문서 본문/버전/해시는 수정할 수 없고 새 버전을 append한다.
정책 변경의 재동의 필요 여부는 reviewed migration의 required/current로 정한다. 단순 문구 변경을 모두 재동의로 강제하지 않는다.
기존 미상 버전의 terms_agreed_at/privacy_agreed_at은 ym-v1 동의로 backfill하지 않는다.
운영자, 담당자·문의처, 실제 위탁/국외 처리, 보유/로그·백업 파기와 시행일은 개발 단계에 미정이다.
공개 운영 전에 검토하고 새로운 확정 정책 버전을 발행한다. 문서만 보고 법적 적합성이 확정됐다고 보지 않는다.

## V4 배포와 복구

새 Flyway `V4__consent_and_private_withdrawal.sql`. 이전 migration checksum은 변경하지 않는다.
기존 완료 탈퇴 회원의 일반 개인정보를 파기하므로 실제 DB 적용 전 Content 백업·복구 리허설과 보유 정책 승인이 필요하다.
기존 PENDING+WITHDRAWN 행은 WITHDRAWING으로 조정해 Trading 확인 후 파기한다. 과거 확인 문구/동의 버전을 위조하지 않는다.
기존 ACTIVE9~12자 닉네임은 그대로 보존한다. 컬럼 길이12/고유 제약 유지, ACTIVE/WITHDRAWING nickname 필수, WITHDRAWN만NULL이다.
기존 회원을 일괄 provisioning 큐에 넣지 않는다. 신규 가입만 큐에 기록한다.
Trading V17을 먼저 적용하고 호환 API를 실행한 뒤 Content V4를 적용한다. 실제 운영 적용 전 writer를 정지하고 백업한다.
신뢰 URL/인증 공개키/서명키·전송 활성 설정을 확인하고 PENDING/attempts와 Trading 계정 상태를 점검한다.
애플리케이션 rollback만으로 파기된 개인정보가 복구되지 않는다. 전체 복원은 재가입 중복·금융 원장/서비스 상태와 함께 검토해야 한다.
이번 자동 검증은 임시 PostgreSQL/로컬 mock HTTP만 사용한다. 실제 개발/운영 DB 또는 Volume은 변경하지 않는다.
