# Yogimangchi Frontend

Yogimangchi V2의 웹 프론트엔드 프로젝트입니다.

모바일 환경을 기준으로 화면을 설계하고, Tablet과 Desktop으로 확장하는 Mobile First 방식을 사용합니다.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- TradingView Lightweight Charts
- Native Fetch
- TanStack Query

Redux는 복잡한 전역 Client State 관리가 실제로 필요한 경우에만 도입합니다.

## Development

의존성 설치:

```bash
npm install
```

개발 서버 실행:

```bash
npm run dev
```

기본 개발 주소:

```text
http://localhost:3000
```

## Backend

Trading Server:

```text
http://localhost:8081
```

Swagger UI:

```text
http://localhost:8081/swagger-ui/index.html
```

Runtime OpenAPI:

```text
http://localhost:8081/v3/api-docs
```

API 연동 시 실행 중인 Trading Server의 Runtime OpenAPI를 기준으로 현재 API 계약을 확인합니다.

## Development Flow

페이지와 기능은 다음 순서로 개발합니다.

```text
Markup
  ↓
Design
  ↓
Function
```

마크업, 디자인, 기능 구현은 한 번에 진행하지 않습니다.

세부 개발 규칙은 `AGENTS.md`를 따릅니다.

## Frontend Responsibility

Frontend는 사용자에게 Trading 정보를 표현하고 사용자 입력을 Backend에 전달합니다.

체결 가격, PnL, Margin, Liquidation 등 Trading의 최종 판단은 Trading Server가 담당합니다.

실시간 Trading 데이터 역시 Browser에서 Binance에 직접 연결하지 않고 Trading Server를 통해 사용합니다.

## Guest 조회 세션

`TradingDataProvider`는 Trading workspace만 감싼다. Root Layout은 Server Component를 유지한다.
`@tanstack/react-query` 5.104.2는 조회 캐시, 요청 중복 제거, 취소 및 제한된 재시도를 담당한다.
기존 native fetch는 HTTP 전송에 사용한다. React 18/19를 지원하며 Redux/BFF는 추가하지 않는다.

Guest는 서버에서 발급하는 7일 만료 opaque Bearer credential이다. JWT가 아니다.
토큰은 API 모듈 내부와 해당 서버 origin 전용 `sessionStorage`에만 보관한다.
새로고침에는 유지되고 탭 세션 종료 시 사라진다. localStorage의 장기 보존을 피하고,
HttpOnly cookie/BFF는 현재 브라우저 직접 Bearer API 구조와 맞지 않아 도입하지 않는다.
sessionStorage도 XSS에는 노출될 수 있으므로 로그·URL·오류·Query 캐시에 토큰을 넣지 않는다.
저장소가 차단되면 계정을 생성하기 전에 오류를 표시한다.

부트스트랩 및 인증 복구는 동시에 한 요청만 실행한다. 401/로컬 만료는 기존 credential을 제거한 뒤
자동으로 한 번 재생성한다. 재생성 후에도 인증이 실패하면 중단하며 명시적 재시도로만 재개한다.
403은 새 계정 생성으로 해결하지 않는다. Guest POST는 응답 유실 시 중복 계정이 생길 수 있어
자동 재시도하지 않는다. 초기 생성 실패 후 재시도는 사용자가 선택한다.
계정 ID와 세대 번호로 조회 키를 분리하고 계정 변경 시 이전 요청/캐시를 취소·제거한다.
REST 읽기는 네트워크 오류와 500/502/503/504만 최대 두 번 재시도한다. 4xx/파싱 오류는 자동 재시도하지 않는다.

도입 시 npm audit: 새 TanStack 패키지 경고 없음. 기존 ESLint 개발 도구 체인의
braces → micromatch → fast-glob 경로에 high 5건이 보고되었다. 제안된 해결은 Next ESLint의
major downgrade이므로 이 작업에서 강제 변경하지 않는다.

Account/Wallet/Positions는 `GET /api/v1/trading/account/summary`의 동일 시점 스냅샷을 공유한다.
별도 `/wallet`, `/positions`도 있지만 같은 Summary를 내부에서 계산하므로 중복 호출하지 않는다.
화면과 Doughnut은 같은 positions를 사용하고 기존 BigInt 증거금 배분 계산을 유지한다.
활성 종목 목록에 없는 과거 종목은 이름을 추측하지 않고 `종목 #ID`로 표시한다.
금융 값은 문자열로 보관하고 null 평가 값은 `—`로 표시한다. Preview 계정/포지션은 제거했다.
조회 시각을 표시하며 15초 staleTime 후 포커스/재연결 및 수동 새로고침으로 갱신한다.
Account REST는 실시간 WebSocket이 아니며 Market Chart 오류 상태와 분리된다.
