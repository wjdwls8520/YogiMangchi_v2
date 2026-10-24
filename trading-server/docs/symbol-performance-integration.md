# 종목별 성과 API 연동 계약

`GET /api/v1/trading/account/performance/symbols` — 기존 Guest Bearer 또는 회원 Access JWT. accountId를 입력받지 않고 인증 주체의 계정만 집계한다. Content 인증 계약 변경은 없다.

## 범위와 금액

- 선택 필터: `from` 포함, `before` 제외 (UTC ISO8601, 마이크로초 이하), `roundId` (자신의 회원 회차), `tradingSymbolId`.
- 기본 기간은 epoch부터 응답 capturedAt 직전이다. 전체 선택 범위를 집계하며 이력 페이지 크기와 무관하다.
- 동일 종목 LONG/SHORT를 합산한다. 실제 Fill의 `price*quantity`를 OPEN, CLOSE, LIQUIDATE 각각 한 번씩 더한다. 왕복 진입/종료는 두 체결 거래대금이다. Domain 수량·정규화 Mark 가격을 사용한다.
- 미체결·거절·취소·관리상 종료는 거래대금/체결 수에서 제외한다. 회차 재시작 지급은 거래 손익이 아니다.
- grossRealizedPnl, fees, settlementAdjustment를 분리한다. economicTradingPnl=gross-fees, cashTradingPnl=economic+격리 손실 조정이다.
- turnoverSharePercent는 필터로 선택한 전체 거래대금에 대한 비중이다. 총 거래대금0이면0이다. 금액은 Decimal 문자열, 비중은 소수8자리 HALF_EVEN이다.
- 응답 최상위 capitalAdjustment는 선택 기간의 계정 재시작/Guest 재도전 자본 조정 합계다. 종목으로 배분하지 않으며 종목 손익에도 포함하지 않는다. roundId가 있으면 해당 회차 시작 자본 조정만 선택한다.

## 현재 평가와 수익률

- symbols의 currentUnrealizedPnl은 **현재** OPEN 노출이며 과거 기간 필터와 별개다. roundId/종목 소유 범위는 적용한다. 기간 내 Fill이 없어도 현재 노출이 있으면 행을 반환한다.
- 각 행의 valuationStatus, priceEventTime, priceReceivedAt, valuedAt을 함께 사용한다. 가격이 FRESH가 아니면 평가액은 null이다. 노출이 없으면0/NO_OPEN_EXPOSURE다.
- 종목 수익률은 제공하지 않는다. 담보 재사용·추가 진입·레버리지 변경으로 일관된 투자원금 분모를 정할 수 없으므로 포지션 ROE 평균이나 initialMargin 합계를 사용하지 않는다.
- roundReturn은 기간/종목을 좁히지 않은 **회원 회차 전체**에만 제공한다. `100*(종료자산-초기자금-회차내 자본조정)/초기자금`이다. 현재 회차는 현재 평가자산, 완료 회차는 고정된 final_wallet 잔액을 사용한다.
- 현재 제품은 회차 내부 입출금이 없고 재시작 자금 조정은 새 회차 초기자금 설정 전 발생하므로 회차내 자본조정은0이다. 최상위 capitalAdjustment와 의미를 혼동하지 않는다. 향후 입출금 추가 시 이 정의를 확장해야 한다.
- LEGACY_UNVERIFIED 회차는 초기금·수익률을 null로 남긴다. 가격 미가용이면 현재 회차 수익률도 null/PRICE_UNAVAILABLE이다.

예: `totals={fillCount:2,turnover:"1100",grossRealizedPnl:"-900",fees:"0.55",settlementAdjustment:"800.05",economicTradingPnl:"-900.55",cashTradingPnl:"-100.5"}`. 격리 조정은 투자자가 벌어들인 매매 이익이 아니다.

## Frontend / 실행

Frontend는 전체 범위 집계를 사용하고 history 페이지를 합산하지 않는다. 금액 문자열을 Number로 합산하지 않는다. 현재 평가와 기간 실현손익을 별도로 표시하고 null을0으로 바꾸지 않는다. 401은 기존 인증 갱신 계약, 400 INVALID_HISTORY_REQUEST는 필터 확인, 404 ROUND_NOT_FOUND는 회차 소유권/존재 확인, 409 TRADING_BUSY는 재조회 대상이다. 개인정보 응답은 no-store다.

신규 의존성·환경변수·migration은 없다. 기존 Flyway/JPA 구조와 계정 잠금을 사용한다. 집계 Transaction5초/SQL4초로 비용을 제한한다. 실제 사용자 DB에는 적용하지 않았다.
Java17/Docker Desktop에서 `trading-server/gradlew.bat -p trading-server clean build`를 실행한다. 테스트는 임시 PostgreSQL/Redis를 사용하고 외부 Binance에 의존하지 않는다. 실행계획/작은 대표 데이터 지연은 테스트 출력 PERFORMANCE_MEASUREMENT에 남기며 운영 TPS/수용 인원 보장은 아니다.
