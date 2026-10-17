# Trading UI: Backend 협의 항목

현재 실행 중인 `/v3/api-docs`와 Backend source를 읽기 전용으로 확인한 결과다. 이 작업에서 Backend 파일은 수정하지 않았다.

## 우선 요청: 100배 실제 주문

- 현재 `CreateOrderRequest.leverage` OpenAPI 상한, `TradingMath.MAX_LEVERAGE`, 주문 서비스 검증은 20이다.
- Position/Order 테이블에도 `leverage BETWEEN 1 AND 20` CHECK가 있다.
- Backend Work에서 지원 정책·위험/증거금 계산 영향을 검토하고, 검증·OpenAPI·테스트와 **기존 DB 제약을 변경하는 새 migration**을 함께 적용해야 한다. 기존 migration 수정만으로 운영 DB를 바꾸면 안 된다.
- Frontend는 100배까지 입력·참고 계산하되, `SERVER_MAX_LEVERAGE=20`을 넘어선 실제 요청을 차단한다. 서버 반영과 Runtime 계약 확인 후 이 값을 맞춘다.

## Binance 수준의 추가 UX를 위한 계약

| 기능 | 현재 부족한 계약 / 협의할 내용 |
| --- | --- |
| 포지션 내역 | 종료 포지션별 진입/평균 청산 가격, 누적 청산 수량·실현손익, 개설/종료 시각과 pagination. 주문 이력을 포지션 이력으로 추정하지 않는다. |
| TP/SL·Stop·Trailing Stop | 현재 MARKET/LIMIT OPEN 및 CLOSE만 제공된다. 트리거 기준(Mark), 수량 예약·중복·취소·강제청산 경합과 idempotency 정책을 포함한 주문 계약이 필요하다. |
| 청산가·Margin Health | 서버 기준 liquidationPrice, maintenanceMargin, marginRatio 및 산정/만료 상태가 필요하다. Frontend에서 금융 기준을 추측하지 않는다. |
| Cross/Isolated 전환·기존 포지션 레버리지 변경 | 현재 포지션은 lot별 고정 레버리지다. 지원한다면 증거금 재조정·제약·실패 계약을 먼저 정해야 한다. 지금 Close 주문은 해당 lot의 레버리지를 그대로 사용한다. |
| 계정·강제청산 실시간 알림 | 인증된 Account/Wallet/Position/Order 변경 이벤트, liquidation event, 순서·중복·재연결/누락 복구 계약. 현재 REST polling으로 reconcile한다. |
| Funding | fundingRate, nextFundingTime, 적용/정산 이력과 유효성 상태. 현재 임의 수치를 표시하지 않는다. |
| 독립 체결 내역 | 현재 OrderResponse.fill은 표시 가능하다. 독립적인 Fill/Trade 조회·pagination·수수료 등은 별도 계약이 필요하다. |

## 운영 확인

실제 모의 주문 검증 중 `503 ENGINE_RECOVERING`이 간헐적으로 관찰됐다. Frontend는 자동 재전송하지 않고 같은 Idempotency-Key/요청으로 수동 재확인한다. Backend Work에서 복구 진입 원인·지속 시간·로그를 확인할 수 있다. UI의 성공/체결로 위장하지 않는다.

## 현재 Backend로 가능한 범위

Open/Close 탭, 시장가·지정가 부분 청산, 보유 수량 전체 시장가 청산, CLOSE 예약과 취소, `freeCloseQuantity`/예약 검증, 다중 종목 WS 표시는 기존 계약으로 구현했다. 부분 청산 버튼은 전체 보유 수량 미만만 허용하며 전체 청산은 별도 버튼으로 구분한다.
