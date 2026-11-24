export const NEWS_CATEGORY_LABELS: Record<string, string> = {
  CRYPTO: "가상자산",
  MACRO: "거시경제",
  ONCHAIN: "온체인",
  REGULATION: "규제·정책",
  ECONOMY: "경제",
  MARKET: "시장",
  EXCHANGE: "거래소",
  DEFI: "디파이",
  STOCK: "해외증시",
  FX: "환율·금리",
};

export function formatNewsCategoryKr(raw: string | null | undefined): string {
  if (!raw) return "가상자산";
  const key = raw.trim().toUpperCase();
  return NEWS_CATEGORY_LABELS[key] ?? raw;
}

export const NEWS_SUBCATEGORY_LABELS: Record<string, string> = {
  COIN_FLASH: "코인 속보",
  ECONOMY_FLASH: "경제 속보",
  CRYPTO: "암호화폐",
  US_STOCK: "해외증시",
  OVERSEAS_STOCK: "해외증시",
  FX_RATE: "환율/금리",
  RATES_FX: "환율/금리",
  MACRO: "거시경제",
};

export function formatNewsSubCategoryKr(raw: string | null | undefined): string {
  if (!raw) return "속보";
  const key = raw.trim().toUpperCase();
  return NEWS_SUBCATEGORY_LABELS[key] ?? formatNewsCategoryKr(key);
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  MARKET: "시장가",
  LIMIT: "지정가",
  STOP_MARKET: "손절 시장가",
  TAKE_PROFIT_MARKET: "익절 시장가",
};

export function formatOrderTypeKr(raw: string | null | undefined): string {
  if (!raw) return "-";
  const key = raw.trim().toUpperCase();
  return ORDER_TYPE_LABELS[key] ?? raw;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기 중",
  OPEN: "미체결",
  PARTIALLY_FILLED: "부분 체결",
  FILLED: "체결 완료",
  CANCELED: "취소됨",
  CANCELLED: "취소됨",
  REJECTED: "거절됨",
  EXPIRED: "만료됨",
  LIQUIDATED: "강제청산",
};

export function formatOrderStatusKr(raw: string | null | undefined): string {
  if (!raw) return "-";
  const key = raw.trim().toUpperCase();
  return ORDER_STATUS_LABELS[key] ?? raw;
}

export const POSITION_STATUS_LABELS: Record<string, string> = {
  OPEN: "진행 중",
  CLOSED: "종료됨",
  LIQUIDATED: "강제청산",
  ADMIN_CLOSED: "관리상 종료",
};

export function formatPositionStatusKr(raw: string | null | undefined): string {
  if (!raw) return "-";
  const key = raw.trim().toUpperCase();
  return POSITION_STATUS_LABELS[key] ?? raw;
}

export const ENGINE_STATUS_LABELS: Record<string, string> = {
  READY: "연결됨",
  LIVE: "실시간",
  CONNECTED: "연결됨",
  CONNECTING: "연결 중",
  RECONNECTING: "재연결 중",
  DEGRADED: "지연됨",
  STALE: "지연됨",
  UNAVAILABLE: "중단됨",
  DISCONNECTED: "연결 끊김",
  OFFLINE: "오프라인",
  RUNNING: "정상 가동",
  HALTED: "거래 중지",
  SUSPENDED: "일시 정지",
};

export function formatEngineStatusKr(raw: string | null | undefined): string {
  if (!raw) return "확인 중";
  const key = raw.trim().toUpperCase();
  return ENGINE_STATUS_LABELS[key] ?? raw;
}

export const INQUIRY_CATEGORY_LABELS: Record<string, string> = {
  ACCOUNT: "계정·로그인",
  TRADING: "모의투자·주문",
  CONTEST: "대회·랭킹",
  COMMUNITY: "커뮤니티·신고",
  APPEAL: "제재·이의제기",
  SANCTION_APPEAL: "제재·이의제기",
  SUSPENSION_APPEAL: "정지 이의제기",
  BUG: "오류·버그 제보",
  BUG_REPORT: "오류·버그 제보",
  POLICY: "약관·개인정보",
  GENERAL: "일반 문의",
  OTHER: "기타 문의",
};

export function formatInquiryCategoryKr(raw: string | null | undefined): string {
  if (!raw) return "일반 문의";
  const key = raw.trim().toUpperCase();
  return INQUIRY_CATEGORY_LABELS[key] ?? raw;
}

export const INQUIRY_STATUS_LABELS: Record<string, string> = {
  OPEN: "답변 대기",
  ANSWERED: "답변 완료",
  CLOSED: "종료됨",
};

export function formatInquiryStatusKr(raw: string | null | undefined): string {
  if (!raw) return "답변 대기";
  const key = raw.trim().toUpperCase();
  return INQUIRY_STATUS_LABELS[key] ?? raw;
}

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "정상",
  SUSPENDED: "일시 정지",
  BANNED: "영구 차단",
  WITHDRAWAL_PENDING: "탈퇴 처리 중",
  WITHDRAWN: "탈퇴",
};

export function formatMemberStatusKr(raw: string | null | undefined): string {
  if (!raw) return "정상";
  const key = raw.trim().toUpperCase();
  return MEMBER_STATUS_LABELS[key] ?? raw;
}

export const POSITION_SIDE_LABELS: Record<string, string> = {
  LONG: "롱(매수)",
  SHORT: "숏(매도)",
};

export function formatSideKr(raw: string | null | undefined): string {
  if (!raw) return "-";
  const key = raw.trim().toUpperCase();
  return POSITION_SIDE_LABELS[key] ?? raw;
}
