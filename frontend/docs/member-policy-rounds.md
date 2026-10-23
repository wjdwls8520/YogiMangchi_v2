# 회원 정책·탈퇴·모의투자 회차 연동

2026-10-23 develop 135c705의 Backend 소스 및 실행 중인 8080/8081 OpenAPI 계약을 기준으로 Frontend만 수정했다.

## 연결한 계약

| 영역 | 경로 및 동작 |
|---|---|
| 정책 | Content GET `/api/v1/policies/current`, GET `/api/v1/policies/{type}/{version}`. 원문 SHA-256 검증, 버전별 독립 동의 |
| 가입·재동의 | 기존 `/auth/signup`에 termsVersion/privacyVersion 포함. GET/POST `/members/me/consents`로 이전·현재 동의 및 재동의 처리 |
| 탈퇴 | 기존 Google/Kakao OAuth로 동일 회원 재확인 후 POST `/members/me/withdrawal`, GET 동일 경로로 상태 조회. acknowledged/confirmation/policyVersion, Bearer+CSRF+쿠키 사용 |
| 최초 자금 | 기존 POST `/api/v1/trading/accounts/member`, 현재 Summary와 회차를 확인. 준비 전 404는 자금을 만들어 표시하지 않음 |
| 회차 | Trading GET `/api/v1/trading/account/rounds/current`, `/rounds`, `/rounds/{roundId}`, `/rounds/{roundId}/orders`, `/fills`, `/positions`. 각 목록은 서버 cursorId로 페이지 조회 |
| 다시시작 | Trading POST `/api/v1/trading/account/restart`, Idempotency-Key 필수, 429 MEMBER_RESTART_LIMITED의 nextAvailableAt만 안전하게 보관 |

Content 표의 짧은 경로는 `/api/v1` 아래다. Trading의 개별 회차 ledger 경로는 모두 `/api/v1/trading/account/rounds/{roundId}` 아래다. 임의의 API나 금융 필드를 보완하여 만들지 않았다.

## 정책 게시 및 남은 서버·운영 사항

- 서버 등록 v1은 DEVELOPMENT_DRAFT이며 사용자 제공 전체 원고와 다르다. 페이지·팝업은 서버 원문과 별도 전체 검토 원고를 구분한다. 실제 동의 기록은 서버 원문 버전에만 연결된다.
- 운영 주체, 문의 연락처, 개인정보 담당자, 시행일, 법률 검토 상태는 명시적 placeholder다. 수정 위치는 `policy-content.tsx`의 policyPublication이다. 전체 검토 원고를 게시하려면 검토 후 새 원문/해시/버전을 서버에 등록해야 한다. 공개 운영 준비 완료를 뜻하지 않는다.
- 탈퇴가 오래 걸려 기존 Access가 만료되면 상세 상태 조회를 이어갈 전용 재인증 계약은 없다. 자동 조회는 종료하고 OAuth WITHDRAWAL_PENDING 안내를 사용한다. 서버가 완료하기 전에 완료했다고 표시하지 않는다.
- 커뮤니티 author/mention API는 여전히 미구현이다. 명시적인 WITHDRAWN 상태, `탈퇴한회원`, 프로필 상호작용 차단 및 구조화된 멘션 보존 기준은 [탈퇴 정책 기록](./parity/member-withdrawal-policy.md)을 따른다.
- 현재 회차는 세대별 캐시·REST·WS로 격리하고 현재 회차 조회를 5초마다 수행한다. 다른 기기에서 바뀐 회차를 감지하기 전까지의 전달 지연은 존재한다. 거래 명령은 서버 현재 회차와 계정 잠금이 최종 결정한다.

## 검증

- 자동 테스트: 기존 Guest/회원 로그인·시세·주문 보안 회귀 + 정책 원문/버전/해시/동의 + 탈퇴 확인/단일 요청/PENDING/불확실 결과 + 회차 decimal/커서/계정 격리/다시시작 키 재사용/이전 epoch 차단.
- 실제 회원의 동의 제출, 탈퇴, 다시시작은 실행하지 않았다. 공개 정책 조회와 격리된 UI 검증을 실제 금융 엔진 통합 테스트와 구분한다.
- 정책 모달을 320/390/768/1024/1440/1920px에서 확인했다. ESC/닫기의 미동의 유지와 포커스 복원, 명시 동의→외부 체크 유지→해제, 전체 초안의 내부 스크롤을 확인했다. 재시작 미확인 차단과 탈퇴 문구의 후행 공백 거부도 서버 제출 없는 임시 UI에서 확인하고 테스트 경로는 제거했다.
- Frontend/Backend 병합 후 신규 가입→최초 회차→주문→재시작→과거 원장→탈퇴 PENDING→완료→같은 소셜 새 회원 가입을 최종 검증해야 한다. 개인정보/금융 데이터를 테스트 결과나 PR에 첨부하지 않는다.
