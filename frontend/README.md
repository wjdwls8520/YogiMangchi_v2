# Yogimangchi Frontend

요기망치 V2의 Next.js App Router 애플리케이션이다. Trading·Content 두 서버가 제공하는 API를 연결하며, 금융 상태의 원본은 Trading Server다.

## 기술

- Next.js 16.4.1 이상(현재 `package.json`의 `^16.4.1` 범위), React 19.3, TypeScript 5.9, Tailwind CSS 4.
- TanStack Query, Lightweight Charts, Chart.js 사용. 정확한 실행 버전은 `package-lock.json`을 기준으로 확인한다.
- 구현된 주요 화면: 거래, 로그인·OAuth 콜백, 계정/회차, 회원 공개 프로필, 이용약관·개인정보처리방침.
- 커뮤니티·뉴스의 완성 화면은 현재 `develop`의 구현 범위로 가정하지 않는다.

## API·인증

- Trading Origin: `NEXT_PUBLIC_TRADING_SERVER_URL` (로컬 예시 `http://127.0.0.1:8081`).
- Content Origin: `NEXT_PUBLIC_CONTENT_SERVER_URL` (로컬 예시 `http://localhost:8080`).
- `.env.example`에 남은 정책 URL 예시를 실제 사용 기능으로 단정하지 않는다. 현재 정책 화면은 Content의 버전·문서·해시 계약과 연결 상태를 확인한다.
- Guest: Trading 발급 7일 opaque Bearer Token(JWT 아님), 회원 계정과 독립.
- 회원: Google/Kakao OAuth2 → Content 자체 Access JWT(메모리)·HttpOnly Refresh Cookie. CSRF, 다중 탭 충돌 방지 및 활성 탭 중심 갱신 로직 사용.
- 금융 계산: 잔고·체결·PnL·청산의 확정값은 Trading 응답을 사용한다. 새 주문 레버리지 범위는 현재 서버 기준 1~100배이며, Backend 설정은 계정·종목·LONG/SHORT 방향별 독립이다. Frontend는 각 방향을 따로 조회·변경하고 해당 방향의 견적·주문과 연결해야 한다.
- 회원 첫 거래 회차는 10,000 USDT. 회차 재시작·이력·탈퇴 상태는 서버 API로 조회한다.
- 정책 화면은 서비스 공개 전 운영자가 확정한 정식 약관·개인정보처리방침과 일치하는지 별도 검증이 필요하다.

## 로컬 실행

```bash
cd frontend
npm ci
npm run dev
```

필요한 경우 `frontend/.env.example`을 참고하여 `.env.local`에 서버 Origin을 지정한다. 공개 환경에서는 OAuth Redirect, 쿠키의 same-site/secure, CORS 및 배포 도메인을 함께 확인한다.

## 검증

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

다음 조건을 특히 확인한다: Guest·회원 전환, 로그인/로그아웃/탈퇴, Access 만료와 다중 탭 Refresh, 중복 주문 방지, WS 재연결, 주문 미확정 응답 처리 및 계정·회차 이력.

Backend 계약은 각 서버의 현재 Runtime OpenAPI(`/v3/api-docs`) 및 실제 Controller/DTO가 기준이다. 백엔드 수정이 필요하면 별도 담당 PR로 요청하고, 이번 Frontend 변경에 섞지 않는다. Git·MD 규칙은 [`AGENTS.md`](AGENTS.md) 및 [`../AGENTS.md`](../AGENTS.md)를 따른다.

## 연동 기준과 다음 작업

2026-10-25 확인 기준 develop `0e47eac`의 Backend는 방향별 레버리지·성과·복구 계약이 반영됐지만 기존 develop Frontend는 side 없는 요청을 사용한다. `feature/frontend/trading-stability`의 `3b2ba63` 작업본은 독립 레버리지·성과·복구 연동을 포함하며 당시 미병합이었다. 새 작업에서는 최신 PR/커밋·실행본을 다시 확인한다. 오래된 Frontend를 최신 Backend와 그대로 조합하지 않는다.

- [Backend 방향별 레버리지](../trading-server/docs/side-leverage-integration.md)
- [종목별 성과](../trading-server/docs/symbol-performance-integration.md)
- [계정 복구와 오류](../trading-server/docs/risk-recovery-integration.md)
- [원장 대사 검토 상태](../trading-server/docs/ledger-reconciliation-integration.md)
- [Content 인증 계약](../content-server/docs/auth-integration.md)
- [회원 정책·회차 연동 기록](docs/member-policy-rounds.md)

로컬 회원 테스트는 Frontend를 `http://localhost:3000`으로 열고 Content Origin 및 OAuth 콜백도 같은 사이트로 일치시킨다. 포트가 다르면 CORS·WS Origin 허용 범위를 확인한다. Backend용 비밀값을 NEXT_PUBLIC 변수에 넣지 않는다.

당시 최신 작업본246개 자동 테스트·타입·린트·production build가 통과했으나 실제 거래 엔진 적체로 전체 거래 E2E는 완료되지 않았다. 다음 작업은 Backend 적체 개선본과 연동하여 LONG/SHORT 독립 설정·주문·청산, 재동의/복구 안내와 모바일·데스크톱 반응성을 검증하는 것이다. Backend·Frontend 각각의 통과를 통합 성공으로 간주하지 않는다.
