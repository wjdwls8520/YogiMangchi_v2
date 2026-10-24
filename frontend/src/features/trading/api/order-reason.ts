const reasons: Record<string, string> = {
  INSUFFICIENT_MARGIN: "증거금과 수수료를 위한 잔액이 부족합니다.",
  INSUFFICIENT_SETTLEMENT_CASH: "정산에 필요한 잔액이 부족합니다.",
  POSITION_LIMIT_REACHED: "보유 포지션 수 상한에 도달했습니다.", POSITION_LIMIT: "보유 포지션 수 상한에 도달했습니다.",
  PENDING_LIMIT_REACHED: "미체결 주문 수 상한에 도달했습니다.",
  ORDER_SIZE_LIMIT_EXCEEDED: "주문 또는 통합 포지션 거래대금 상한을 초과했습니다.",
  UNSUPPORTED_EXECUTION_NOTIONAL: "체결 거래대금이 허용 범위를 벗어났습니다.",
  ACCOUNT_AT_RISK: "현재 포지션의 청산 위험으로 거절되었습니다.",
  SYMBOL_NOT_AVAILABLE: "현재 거래가 중단된 종목입니다.", SYMBOL_NOT_ACTIVE: "현재 거래가 중단된 종목입니다.",
  POSITION_LIQUIDATION: "대상 포지션이 강제청산되었습니다.", POSITION_NOT_OPEN: "대상 포지션이 이미 종료되었습니다.",
  ORDER_NOT_PENDING: "이미 처리된 주문입니다.", MARKETABLE_LIMIT_NOT_ALLOWED: "현재 Mark를 교차하는 지정가는 허용되지 않습니다.",
  LEVERAGE_MISMATCH: "방향별 레버리지 설정이 변경되었습니다.", INVALID_ORDER: "주문 조건이 허용 범위를 벗어났습니다.",
  ACCOUNT_RISK_PENDING: "수신된 가격 위험 작업을 처리 중입니다.", ACCOUNT_RECOVERY_HELD: "가격 위험 기록의 운영 검토가 필요합니다.",
  MEMBER_RESTART: "모의투자 다시시작으로 취소되었습니다.", MEMBER_WITHDRAWAL: "회원 탈퇴 정리로 취소되었습니다.",
};
export function orderReason(reason: string | null | undefined) {
  return reason ? reasons[reason] ?? "서버에서 처리했습니다. 알려진 상세 사유가 없습니다." : "—";
}
