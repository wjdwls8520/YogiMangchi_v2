# 회원 탈퇴 정책 연동 상태 (2026-10-23)

> 후속 상태: Backend PR #38(135c705)에서 확인 본문·최근 동일 회원 OAuth·개인정보 정리·새 ID 재가입 및 회차 계약이 추가되어 Frontend 연동을 구현했다. 최신 상태와 남은 제한은 [회원 정책·회차 기록](../member-policy-rounds.md)을 따른다. 아래 조사와 차단 설명은 PR #38 이전의 감사 기록이며 현재 버튼 상태를 뜻하지 않는다. 커뮤니티/멘션 기준은 유지한다.

서비스 소유자가 전달한 최신 탈퇴 정책을 기준으로 한다. 이 Work는 `frontend/**`만 수정하며 Content/Trading/DB 구현은 읽기 전용으로 확인했다. 아래 Backend 변경은 요청사항이며 적용된 계약이 아니다.

## 현재 확인한 차이

| 요구 | 현재 구현 근거 | 필요한 Backend 작업 |
|---|---|---|
| memberId 유지·WITHDRAWN·탈퇴 시각 | Member.withdraw 및 MemberWithdrawals에 존재 | 기존 동작 재사용 |
| 닉네임·소개·OAuth 식별정보 제거 | withdraw는 소개만 비우며 nickname 및 oauth_identity의 provider_subject/email을 남긴다. DB nickname NOT NULL UNIQUE | 활성 회원만 유효 닉네임 강제; 탈퇴 nickname NULL; OAuth 연결/개인정보 제거 및 캐시·세션·필요 증빙 분류 |
| 같은 OAuth로 재가입 시 새 memberId | AuthService.flow는 기존 OAuth 연결이 있으면 active(memberId)를 요구한다 | 탈퇴 연결 제거 후 SIGNUP_REQUIRED 및 새 회원 생성; 기존 ID/금융 이력 복원·병합 금지 |
| 확인 문구·동의의 서버 검증 | Runtime POST /api/v1/members/me/withdrawal에 requestBody가 없다 | 확인 문구·정책 버전·명시 동의·필요한 최근 본인 확인 및 최소 증빙 계약 확정 |
| 확정 직후 기존 JWT 및 거래 엔진 차단 | Content는 PENDING을 기록하고 WithdrawalDelivery가 기본 5초 주기로 Trading에 전달한다. Controller에도 전달 전 Access 유효 가능성이 명시되어 있다 | 차단 경계·실패/재시도/재시작 계약. Trading 차단 확인 전 COMPLETED 금지; 기존 JWT·WS·매칭·강제청산·계정 생성의 우회 경로 검증 |
| 새 Fill/PnL/fee 없이 관리상 종료 | Trading MemberWithdrawal은 계정 lock, PENDING 취소, closeForWithdrawal, 예약 해제 및 WITHDRAWN을 구현한다 | 검증된 정산 경로 재사용; 탈퇴/신규 주문/체결/강제청산 경합 및 중복 실행 통합 테스트 |
| 게시글·댓글·멘션 보존 및 작성자 표시 | V2 커뮤니티 계약은 B8 미구현 | 아래 표시 계약을 구현 시 적용; 없는 API/UI를 완료 처리하지 않음 |

## Frontend 반영 및 차단

- 기존 탈퇴 dialog에 복구 불가·개인정보/로그인 연결 제거·새 계정 재가입·금융 이력 이전 불가·관리상 종료·게시글/거래 기록 보존·Guest 분리 안내를 준비했다.
- 미리 선택하지 않은 필수 확인과 정확한 `탈퇴합니다` 입력란을 준비했다. 법적으로 공인된 전자서명이라고 표현하지 않는다.
- **BLOCKED BY BACKEND:** 현재 요청은 확인 문구를 검증하지 않고 새 정책을 보장하지 않는다. 버튼을 비활성화하고 form 제출도 막으며, 기존 무본문 탈퇴 POST를 호출하지 않는다. 임의의 새 요청 필드를 보내고 서버가 검증한다고 간주하지 않는다.
- 이 조치는 Frontend의 기존 경로만 막는다. 기존 Backend API의 직접 호출이나 거래 엔진 차단 공백을 해결한 것은 아니다.
- 서버의 실제 요청/응답/OpenAPI 계약과 차단 보장이 반영되면 확인 완료 → 요청 → PENDING/COMPLETED의 정확한 안내 → 메모리 세션/쿼리/WS 정리 및 다른 탭 통지를 연결한다. 재인증/실패 복구 방식도 계약 확인 후 구현한다.
- 실제 회원 탈퇴·DB 삭제·기존 거래 변경은 실행하지 않았다. DB 구조·Backend API 변경 없음.

## 커뮤니티 및 멘션 계약 / 검증 기준

Backend가 공개 author/mention 대상에 memberId와 명시적인 회원 상태를 제공해야 한다. ACTIVE인데 nickname이 비었다고 WITHDRAWN으로 추정하지 않는다. WITHDRAWN이면 표시 이름은 정확히 `탈퇴한회원`, 프로필 링크와 상호작용은 차단한다. 과거 본문과 작성 시각/ID/작성자 참조는 보존한다.

멘션은 memberId와 본문 범위 또는 구조화된 노드로 대상을 식별한다. 이름 변경은 같은 대상 ID를 유지한다. 탈퇴한 대상만 `@탈퇴한회원`으로 표시하며 본문 원본을 통째로 치환하지 않는다. 대상 ID 없는 과거 문자열 멘션은 임의 회원으로 매칭하지 않는다.

Backend B8 준비 후 아래를 실제 DTO 기반 자동/화면 테스트로 검증한다. 현재는 설계 기준이며 실행된 커뮤니티 테스트가 아니다.

1. ACTIVE 작성자의 정상 이름 및 프로필 링크 유지.
2. WITHDRAWN 작성자의 글·댓글·대댓글 보존, 표시 이름 변경 및 링크/상호작용 차단.
3. ACTIVE + 빈 nickname은 계약 오류로 처리하며 탈퇴자로 오표시하지 않음.
4. 구조화된 멘션 중 탈퇴한 대상만 표시 변경, 다른 대상·본문 원본 불변.
5. 닉네임 변경 후 같은 memberId의 멘션 대상 유지.
6. 과거 문자열 멘션을 추정 치환하지 않으며 새 회원에 과거 콘텐츠를 이전하지 않음.

## 서버 작업 전달 사항

최신 탈퇴 요구사항 전체와 위 차이를 Content/Trading Work에서 반영해 주세요. 두 서비스의 데이터 소유권은 유지하고 상대 테이블 직접 조작은 금지합니다. 개인정보 항목별 제거/보존 목록, 안전한 마이그레이션, 서버 확인 검증, 거래 차단의 확정 시점, 장애 중 상태/재시도 및 최소 증빙을 먼저 확정해 주세요. 기존 MemberWithdrawals/WithdrawalDelivery/MemberWithdrawal을 재사용하고 금융 정합성 테스트를 완화하지 마세요.

Frontend 연동에 필요한 산출물: 실제 확인 Request DTO, 오류 code, 재인증 흐름, 요청의 멱등성 및 불확실 응답 확인 방식, PENDING/COMPLETED 의미와 조회 방법, 기존 JWT/WS 차단 시점, 실제 OpenAPI. 이용약관·개인정보처리방침에는 제거 항목과 남는 콘텐츠/거래 기록을 일치시켜야 하며, 법적 보존 예외의 근거·기간은 별도 검토합니다. V1의 30일 소셜 식별정보 보관을 자동 계승하지 않습니다.

## 닉네임 추가 확인

- 최초 조사 당시 브랜치와 실행 서버는 `[가-힣a-zA-Z0-9]{2,12}`를 검사했다. 공개 availability 조회에서 `가` 400, `ㄱㄱ` 400, `ㅏㅏ` 400, `가나` 200을 확인했다. 회원 생성/수정은 하지 않았다.
- 이후 최신 `origin/develop b606e10`의 PR #36이 NicknamePolicy를 1~8 Unicode L/N 코드 포인트로 통일한 것을 확인했다. 이는 Frontend의 승인된 규칙과 일치한다. 기존 긴 닉네임은 조회/로그인을 유지하며 소개만 변경할 때 nickname을 보내지 않으면 보존된다. Frontend도 변경하지 않은 nickname은 PATCH에서 생략한다.
- Frontend 중복 확인은 빈 값·길이·공백·제어/보이지 않는 문자·특수문자 오류를 구분한다. 서버의 일반 400만으로 제거된 최소2자/언어/자음·모음 제한을 추정하지 않는다. available=false 또는 NICKNAME_UNAVAILABLE만 실제 중복으로 표시한다. busy/일반409/연결 실패/계약 오류를 중복으로 단정하지 않는다.
- 입력 변경 시 이전 결과를 지우고 진행 중 조회를 취소한다. 서버 detail/credential/URL은 표시하지 않는다.
- PR #36 반영 서버의 실제 닉네임 응답은 서버 재시작 후 재확인이 필요하다. 규칙별 오류 code가 추가되면 서버 고유 거절 사유도 추정 없이 안내할 수 있다.

## 이번 Frontend 검증

통합 전 자동 테스트209개·lint·typecheck·프로덕션 webpack build 통과. 최초 실제 서버의 기존 형식 오류 표시, 입력 변경 시 이전 오류 제거, 탈퇴 안내 dialog와 비활성 최종 버튼을 확인했다. 임시 입력은 기존 닉네임으로 되돌렸으며 프로필 저장·탈퇴 POST는 실행하지 않았다. PR #36 계약 반영 후에는 제거된 제한을 오안내하지 않는 테스트와 기존 긴 닉네임의 소개 변경 마크업 테스트를 포함해210개가 통과했다. 위 Backend 통합 시나리오나 DB 검증 완료를 뜻하지 않는다.
