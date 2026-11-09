package com.yogimangchi.content.news;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;

public final class NewsAnalyzer {
    private static final List<String> BULLISH_KEYWORDS = List.of(
            "상승", "반등", "돌파", "강세", "순유입", "최고", "급등", "승인", "확대",
            "개선", "호조", "기대", "매수", "회복", "신고가", "유입", "상향", "랠리", "급증"
    );

    private static final List<String> BEARISH_KEYWORDS = List.of(
            "하락", "급락", "약세", "순유출", "해킹", "지연", "우려", "경고", "축소",
            "위기", "폭락", "청산", "충격", "매도", "하향", "소송", "제재", "둔화", "긴축"
    );

    private static final List<String> REGULATION_KEYWORDS = List.of(
            "규제", "법안", "sec", "금융위", "당국", "과세", "소송", "승인", "입법", "제재", "가이드라인"
    );

    private static final List<String> ONCHAIN_KEYWORDS = List.of(
            "온체인", "고래", "스테이킹", "레이어2", "dex", "미결제약정", "펀딩비", "해시레이트", "지갑", "트랜잭션", "체인"
    );

    private static final List<String> MACRO_KEYWORDS = List.of(
            "연준", "금리", "fomc", "cpi", "물가", "환율", "원달러", "달러 인덱스", "국채", "나스닥", "증시", "s&p", "고용", "관세", "뉴욕증시"
    );

    public record AnalysisResult(
            String category,
            String symbolTag,
            String sentiment,
            String aiSummary
    ) { }

    private NewsAnalyzer() { }

    public static AnalysisResult analyze(String title, String summary, String section, String subCategory) {
        String safeTitle = title == null ? "" : title.strip();
        String safeSummary = summary == null ? "" : summary.strip();
        String combined = (safeTitle + " " + safeSummary).toLowerCase(Locale.ROOT);

        String symbolTag = extractSymbolTag(combined);
        String category = classifyCategory(combined, subCategory);
        String sentiment = classifySentiment(safeTitle.toLowerCase(Locale.ROOT), safeSummary.toLowerCase(Locale.ROOT));
        String aiSummary = buildAiSummary(category, subCategory, symbolTag, sentiment);
        return new AnalysisResult(category, symbolTag, sentiment, aiSummary);
    }

    public static String extractSymbolTag(String lowerCombined) {
        if (lowerCombined == null || lowerCombined.isEmpty()) {
            return null;
        }
        if (lowerCombined.contains("비트코인") || containsToken(lowerCombined, "btc") || lowerCombined.contains("bitcoin")) {
            return "BTC";
        }
        if (lowerCombined.contains("이더리움") || containsToken(lowerCombined, "eth") || lowerCombined.contains("ethereum")) {
            return "ETH";
        }
        if (lowerCombined.contains("솔라나") || containsToken(lowerCombined, "sol") || lowerCombined.contains("solana")) {
            return "SOL";
        }
        if (lowerCombined.contains("리플") || containsToken(lowerCombined, "xrp") || lowerCombined.contains("ripple")) {
            return "XRP";
        }
        return null;
    }

    private static boolean containsToken(String text, String token) {
        int idx = 0;
        while ((idx = text.indexOf(token, idx)) >= 0) {
            boolean leftBoundary = idx == 0 || !Character.isLetterOrDigit(text.charAt(idx - 1));
            int end = idx + token.length();
            boolean rightBoundary = end >= text.length() || !Character.isLetterOrDigit(text.charAt(end));
            if (leftBoundary && rightBoundary) {
                return true;
            }
            idx = end;
        }
        return false;
    }

    private static String classifyCategory(String lowerCombined, String subCategory) {
        for (String kw : REGULATION_KEYWORDS) {
            if (lowerCombined.contains(kw)) {
                return "REGULATION";
            }
        }
        for (String kw : ONCHAIN_KEYWORDS) {
            if (lowerCombined.contains(kw)) {
                return "ONCHAIN";
            }
        }
        if ("ECONOMY_FLASH".equals(subCategory) || "STOCKS".equals(subCategory) || "FX_RATES".equals(subCategory)) {
            return "MACRO";
        }
        for (String kw : MACRO_KEYWORDS) {
            if (lowerCombined.contains(kw)) {
                return "MACRO";
            }
        }
        return "CRYPTO";
    }

    private static String classifySentiment(String lowerTitle, String lowerSummary) {
        int bullScore = 0;
        int bearScore = 0;
        for (String kw : BULLISH_KEYWORDS) {
            if (lowerTitle.contains(kw)) {
                bullScore += 2;
            }
            if (lowerSummary.contains(kw)) {
                bullScore += 1;
            }
        }
        for (String kw : BEARISH_KEYWORDS) {
            if (lowerTitle.contains(kw)) {
                bearScore += 2;
            }
            if (lowerSummary.contains(kw)) {
                bearScore += 1;
            }
        }
        if (bullScore > bearScore) {
            return "BULLISH";
        }
        if (bearScore > bullScore) {
            return "BEARISH";
        }
        return "NEUTRAL";
    }

    private static String buildAiSummary(String category, String subCategory, String symbolTag, String sentiment) {
        String prefix = switch (sentiment) {
            case "BULLISH" -> "[AI 강세 분석] ";
            case "BEARISH" -> "[AI 약세 주의] ";
            default -> "[AI 시장 브리핑] ";
        };
        String symbolLabel = symbolTag != null ? "#" + symbolTag + " " : "";
        String body;
        if ("ONCHAIN".equals(category)) {
            body = switch (sentiment) {
                case "BULLISH" -> symbolLabel + "온체인 수급 및 지갑 지표에서 매수 우위 시그널이 포착되었습니다. 거래소 순유출입과 선물 미결제약정 추이를 함께 점검하세요.";
                case "BEARISH" -> symbolLabel + "온체인 물량 이동 및 단기 차익실현 압력이 감지되었습니다. 고배율 포지션의 청산가 여유폭을 점검하세요.";
                default -> symbolLabel + "온체인 네트워크 활성도와 스테이킹·유동성 지표를 바탕으로 중기 수급 방향성을 확인할 시점입니다.";
            };
        } else if ("REGULATION".equals(category)) {
            body = switch (sentiment) {
                case "BULLISH" -> symbolLabel + "제도권 편입 및 정책 불확실성 완화로 기관 유동성 유입 기대감이 높아지고 있습니다.";
                case "BEARISH" -> symbolLabel + "규제 당국의 감독 강화 이슈로 단기 변동성이 확대될 수 있으니 레버리지 비중에 유의하세요.";
                default -> symbolLabel + "주요국 가상자산 정책 및 규제 가이드라인 변화에 따른 시장 수급 영향을 면밀히 주시하세요.";
            };
        } else if ("MACRO".equals(category) || "STOCKS".equals(subCategory) || "FX_RATES".equals(subCategory)) {
            body = switch (sentiment) {
                case "BULLISH" -> symbolLabel + "글로벌 거시 지표 및 증시 위험선호 심리 개선이 가상자산 선물 시장의 단기 매수세를 지지할 수 있습니다.";
                case "BEARISH" -> symbolLabel + "금리·환율 및 거시 불확실성 확대로 위험자산 변동성이 커질 수 있어 격리마진 및 손절 라인 점검이 권장됩니다.";
                default -> symbolLabel + "미 증시·국채금리·달러 인덱스 흐름과 암호화폐 선물 시장 간 동조화 추이를 함께 확인하세요.";
            };
        } else {
            body = switch (sentiment) {
                case "BULLISH" -> symbolLabel + "수급 유입 및 매수 심리 개선 시그널이 포착되었습니다. 단기 저항선 돌파 여부와 선물 펀딩비 과열 여부를 함께 점검하세요.";
                case "BEARISH" -> symbolLabel + "단기 매도 압력 및 변동성 확대 구간입니다. 추격 진입을 자제하고 지지선 방어 여부를 확인하세요.";
                default -> symbolLabel + "현물 거래대금과 무기한 선물 미결제약정(OI) 변화를 통해 방향성 돌파 여부를 관찰하세요.";
            };
        }
        String result = prefix + body;
        return result.length() > 400 ? result.substring(0, 400) : result;
    }

    public static String computeExternalHash(String title, String sourceUrl) {
        String normalizedTitle = normalizeTitleForHash(title);
        String basis = !normalizedTitle.isEmpty()
                ? "title:" + normalizedTitle
                : "url:" + (sourceUrl == null ? "" : sourceUrl.strip());
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(basis.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public static String normalizeTitleForHash(String title) {
        if (title == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(title.length());
        title.toLowerCase(Locale.ROOT).codePoints().forEach(cp -> {
            if (Character.isLetterOrDigit(cp)) {
                sb.appendCodePoint(cp);
            }
        });
        return sb.toString();
    }
}
