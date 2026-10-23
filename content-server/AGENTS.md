# Content Backend 작업 규칙

루트 README/AGENTS와 현재 코드를 먼저 읽는다. 이 서비스는 회원·인증 및 Content 업무를 소유하며
Trading 금융 원장·계정·주문을 직접 조회하거나 변경하지 않는다. 다른 서비스 데이터는 memberId 등 ID로만 참조한다.

- 외부 로그인은 Google OAuth2/OIDC와 Kakao OAuth2만 지원한다. 비밀번호 로그인·추가 공급자를 도입하지 않는다.
- 공급자 토큰을 자체 API 인증에 사용하거나 저장하지 않는다. Google sub/Kakao id를 영구 로그인 식별자로 사용한다.
- 이메일만 같은 다른 로그인 계정을 자동 연결하지 않는다. 가입에서 ADMIN 권한을 입력받지 않는다.
- 실제 Secret·서명 개인키·Token 원문을 Repository/로그에 저장하지 않는다. 공개 JWKS에 개인키를 포함하지 않는다.
- 승인된 Access/Refresh 계약을 지키고 변경 시 보안 영향과 클라이언트 계약을 먼저 설명한다.
- 회원 탈퇴·권한 변경 등은 Trading 소유 데이터 직접 수정으로 구현하지 않는다. 기존 JWT 유효 시간과
  서비스 간 상태 전파, 금융 계정 접근 차단을 함께 검토한 뒤 명시적 계약으로 구현한다.
- Guest 금융 이력의 자동 병합을 구현하지 않는다. Frontend는 읽기 전용이다.
- OAuth 외부 호출을 DB Transaction 안에 넣지 않는다. 콜백 state/OIDC nonce·서명 검증을 우회하지 않는다.
- 영속 인증 상태는 PostgreSQL content Schema가 원본이다. Flyway 이전 migration을 수정하지 않는다.
- 로컬 사용자 DB/Volume을 임의 변경하지 않는다. 자동 테스트는 외부 OAuth 네트워크 대신 검증 가능한 mock과 임시 PostgreSQL을 사용한다.
- 담당 변경만 명시적으로 stage한다. git add . / -A, reset/restore/stash/clean/force push를 사용하지 않는다.

실행·환경변수·배포 및 API 계약은 README에서 관리한다.
