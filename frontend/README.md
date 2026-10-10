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