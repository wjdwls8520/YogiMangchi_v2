# Yogimangchi Frontend

요기망치 V2의 Next.js App Router 애플리케이션이다. Trading·Content 두 서버가 제공하는 API를 연결하며, 금융 상태의 원본은 Trading Server다.

## 기술

- Next.js 16.4.1 이상(현재 `package.json`의 `^16.4.1` 범위), React 19.3, TypeScript 5.9, Tailwind CSS 4.
- TanStack Query, Lightweight Charts, Chart.js 사용. 정확한 실행 버전은 `package-lock.json`을 기준으로 확인한다.
- 구현된 주요 화면: 선물 모의투자 거래(`/trading` — 손절 계산기·단건 주문 상세·최근 거래 이벤트 내역 포함), 실시간 경제·코인 뉴스 피드(`/news`), 트레이더 커뮤니티(`/community`), 로그인·OAuth 콜백(`/login`, `/auth/callback`), 계정/회차(`/account`), 회원 공개 프로필(`/members/[memberId]`), 이용약관·개인정보처리방침(`/terms`, `/privacy`).

## API·인증

- Trading Origin: `NEXT_PUBLIC_TRADING_SERVER_URL` (로컬 예시 `http://127.0.0.1:8081`).
- Content Origin: `NEXT_PUBLIC_CONTENT_SERVER_URL` (로컬 예시 `http://localhost:8080`).
- `.env.example`에 남은 정책 URL 예시를 실제 사용 기능으로 단정하지 않는다. 현재 정책 화면은 Content의 버전·문서·해시 계약과 연결 상태를 확인한다.
- Guest: Trading 발급 7일 opaque Bearer Token(JWT 아님), 회원 계정과 독립.
- 회원: Google/Kakao OAuth2 → Content 자체 Access JWT(메모리)·HttpOnly Refresh Cookie. CSRF, 다중 탭 충돌 방지 및 활성 탭 중심 갱신 로직 사용.
- 금융 계산: 잔고·체결·PnL·청산의 확정값은 Trading 응답을 사용한다. 새 주문 레버리지 범위는 현재 서버 기준 1~100배(직접 다른 레버리지를 지정하지 않으면 기본 1배)이며, 설정은 계정·종목·LONG/SHORT 방향별 독립이다. Frontend는 각 방향을 따로 조회·변경하고 해당 방향의 견적·주문과 연결한다.
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

다음 조건을 특히 확인한다: Guest·회원 전환, 로그인/로그아웃/탈퇴, Access 만료와 다중 탭 Refresh, 중복 주문 방지, WS 재연결, 주문 미확정 응답 처리, 계정·회차 이력, 실시간 뉴스 및 커뮤니티(탈퇴한 작성자 `"탈퇴한회원"` 표시 포함).

Backend 계약은 각 서버의 현재 Runtime OpenAPI(`/v3/api-docs`) 및 실제 Controller/DTO가 기준이다. 백엔드 수정이 필요하면 별도 담당 PR로 요청하고, 이번 Frontend 변경에 섞지 않는다. Git·MD 규칙은 [`AGENTS.md`](AGENTS.md) 및 [`../AGENTS.md`](../AGENTS.md)를 따른다.

## 연동 계약 및 참고 문서

- [Backend 방향별 레버리지](../trading-server/docs/side-leverage-integration.md)
- [종목별 성과](../trading-server/docs/symbol-performance-integration.md)
- [계정 복구와 오류](../trading-server/docs/risk-recovery-integration.md)
- [원장 대사 검토 상태](../trading-server/docs/ledger-reconciliation-integration.md)
- [Content 인증 계약](../content-server/docs/auth-integration.md)
- [회원 정책·회차 연동 기록](docs/member-policy-rounds.md)
- [성능·동시성·검증 일지](../BENCHMARK_LOG.md)

로컬 회원 테스트는 Frontend를 `http://localhost:3000`으로 열고 Content Origin 및 OAuth 콜백도 같은 사이트로 일치시킨다. 포트가 다르면 CORS·WS Origin 허용 범위를 확인한다. Backend용 비밀값을 NEXT_PUBLIC 변수에 넣지 않는다. 견적 재조회·세션 잠금 경합·리렌더링 및 일자별 자동 테스트 통과 수치는 [`BENCHMARK_LOG.md`](../BENCHMARK_LOG.md)에 기록한다.
