package com.yogimangchi.content.news;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

public final class NewsRssParser {
    private static final Pattern HTML_TAG_PATTERN = Pattern.compile("<[^>]+>");
    private static final Pattern MULTI_SPACE_PATTERN = Pattern.compile("\\s+");

    public record ParsedFeedItem(
            String title,
            String summary,
            String sourceName,
            String sourceUrl,
            String thumbnailUrl,
            Instant publishedAt
    ) { }

    private NewsRssParser() { }

    public static List<ParsedFeedItem> parse(String xmlContent, String defaultSourceName, String subCategory, int maxItems) {
        if (xmlContent == null || xmlContent.isBlank() || maxItems <= 0) {
            return List.of();
        }
        try {
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setNamespaceAware(true);
            dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
            dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            dbf.setXIncludeAware(false);
            dbf.setExpandEntityReferences(false);

            DocumentBuilder builder = dbf.newDocumentBuilder();
            Document doc = builder.parse(new ByteArrayInputStream(xmlContent.strip().getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();

            List<Element> entries = new ArrayList<>();
            NodeList items = doc.getElementsByTagName("item");
            for (int i = 0; i < items.getLength(); i++) {
                if (items.item(i) instanceof Element el) {
                    entries.add(el);
                }
            }
            if (entries.isEmpty()) {
                NodeList atomEntries = doc.getElementsByTagName("entry");
                for (int i = 0; i < atomEntries.getLength(); i++) {
                    if (atomEntries.item(i) instanceof Element el) {
                        entries.add(el);
                    }
                }
            }

            List<ParsedFeedItem> result = new ArrayList<>();
            for (Element item : entries) {
                if (result.size() >= maxItems) {
                    break;
                }
                ParsedFeedItem parsed = parseElement(item, defaultSourceName, subCategory);
                if (parsed != null) {
                    result.add(parsed);
                }
            }
            return result;
        } catch (Exception e) {
            return List.of();
        }
    }

    private static ParsedFeedItem parseElement(Element item, String defaultSourceName, String subCategory) {
        String rawTitle = cleanText(childText(item, "title"));
        if (rawTitle.isEmpty()) {
            return null;
        }

        String rawSource = cleanText(childText(item, "source"));
        if (rawSource.isEmpty()) {
            rawSource = cleanText(childText(item, "dc:creator"));
        }

        String title = rawTitle;
        String sourceName = rawSource;

        // Google News RSS titles typically end with " - 언론사명"
        int lastDash = title.lastIndexOf(" - ");
        if (lastDash > 6 && title.length() - (lastDash + 3) <= 32) {
            String suffix = title.substring(lastDash + 3).strip();
            if (!suffix.isEmpty()) {
                if (sourceName.isEmpty() || sourceName.equalsIgnoreCase(suffix)) {
                    sourceName = suffix;
                }
                title = title.substring(0, lastDash).strip();
            }
        }
        if (sourceName.isEmpty()) {
            sourceName = (defaultSourceName == null || defaultSourceName.isBlank()) ? "공식 뉴스 피드" : defaultSourceName.strip();
        }

        title = truncate(title, 200);
        sourceName = truncate(sourceName, 80);

        String sourceUrl = extractLink(item);
        String rawDesc = childText(item, "description");
        if (rawDesc.isEmpty()) {
            rawDesc = childText(item, "summary");
        }
        if (rawDesc.isEmpty()) {
            rawDesc = childText(item, "content");
        }

        String cleanedDesc = cleanText(rawDesc);
        if (!sourceName.isEmpty() && cleanedDesc.endsWith(sourceName)) {
            cleanedDesc = cleanedDesc.substring(0, cleanedDesc.length() - sourceName.length()).strip();
        }
        String summary = buildSummary(title, cleanedDesc, sourceName, subCategory);

        String thumbnailUrl = extractThumbnail(item);
        Instant publishedAt = parsePublishedAt(item);

        return new ParsedFeedItem(title, summary, sourceName, sourceUrl, thumbnailUrl, publishedAt);
    }

    private static String buildSummary(String title, String cleanedDesc, String sourceName, String subCategory) {
        String normTitle = NewsAnalyzer.normalizeTitleForHash(title);
        String normDesc = NewsAnalyzer.normalizeTitleForHash(cleanedDesc);
        if (cleanedDesc.length() >= 24 && !normDesc.equals(normTitle) && !normTitle.contains(normDesc)) {
            if (cleanedDesc.startsWith(title)) {
                String remainder = cleanedDesc.substring(title.length()).replaceFirst("^[\\s\\-·:]+", "").strip();
                if (remainder.length() >= 20) {
                    return truncate(remainder, 180);
                }
            } else {
                return truncate(cleanedDesc, 180);
            }
        }
        String contextLabel = switch (subCategory == null ? "" : subCategory) {
            case "ECONOMY_FLASH" -> "글로벌 거시경제 및 통화정책 관련 실시간 속보입니다.";
            case "STOCKS" -> "해외 주요 증시 및 빅테크·지수 동향 관련 주요 뉴스입니다.";
            case "FX_RATES" -> "외환 시장 환율 및 글로벌 국채 금리 동향 브리핑입니다.";
            case "CRYPTO" -> "디지털 자산 생태계 및 기관·온체인 시장 주요 소식입니다.";
            default -> "가상자산 시장 수급 및 주요 종목 변동성 관련 실시간 속보입니다.";
        };
        return truncate(title + " — " + sourceName + " 보도 기반 " + contextLabel, 180);
    }

    private static String extractLink(Element item) {
        NodeList links = item.getElementsByTagName("link");
        for (int i = 0; i < links.getLength(); i++) {
            Node node = links.item(i);
            if (node.getParentNode() == item && node instanceof Element linkEl) {
                String href = linkEl.getAttribute("href");
                if (isValidHttpUrl(href)) {
                    return truncate(href.strip(), 1000);
                }
                String text = linkEl.getTextContent();
                if (isValidHttpUrl(text)) {
                    return truncate(text.strip(), 1000);
                }
            }
        }
        String guid = childText(item, "guid");
        if (isValidHttpUrl(guid)) {
            return truncate(guid.strip(), 1000);
        }
        return null;
    }

    private static String extractThumbnail(Element item) {
        for (String tag : List.of("media:content", "media:thumbnail", "content", "thumbnail", "enclosure")) {
            NodeList nodes = item.getElementsByTagName(tag);
            for (int i = 0; i < nodes.getLength(); i++) {
                if (nodes.item(i) instanceof Element el) {
                    String url = el.getAttribute("url");
                    String type = el.getAttribute("type");
                    if (isValidHttpUrl(url) && (type == null || type.isEmpty() || type.toLowerCase(Locale.ROOT).startsWith("image/"))) {
                        return truncate(url.strip(), 1000);
                    }
                }
            }
        }
        return null;
    }

    private static Instant parsePublishedAt(Element item) {
        for (String tag : List.of("pubDate", "published", "updated", "dc:date")) {
            String raw = childText(item, tag).strip();
            if (!raw.isEmpty()) {
                try {
                    Instant parsed = ZonedDateTime.parse(raw, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
                    return capFutureInstant(parsed);
                } catch (Exception ignored) { }
                try {
                    Instant parsed = Instant.parse(raw);
                    return capFutureInstant(parsed);
                } catch (Exception ignored) { }
                try {
                    Instant parsed = ZonedDateTime.parse(raw, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant();
                    return capFutureInstant(parsed);
                } catch (Exception ignored) { }
            }
        }
        return Instant.now();
    }

    private static Instant capFutureInstant(Instant instant) {
        Instant now = Instant.now();
        return instant.isAfter(now.plusSeconds(300)) ? now : instant;
    }

    private static String childText(Element parent, String tagName) {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node instanceof Element el) {
                String name = el.getTagName();
                String local = el.getLocalName();
                if (tagName.equalsIgnoreCase(name) || tagName.equalsIgnoreCase(local)) {
                    String text = el.getTextContent();
                    return text == null ? "" : text.strip();
                }
            }
        }
        return "";
    }

    public static String cleanText(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String decoded = decodeHtmlEntities(raw);
        String withoutTags = HTML_TAG_PATTERN.matcher(decoded).replaceAll(" ");
        String decodedAgain = decodeHtmlEntities(withoutTags);
        return MULTI_SPACE_PATTERN.matcher(decodedAgain).replaceAll(" ").strip();
    }

    private static String decodeHtmlEntities(String input) {
        return input
                .replace("&nbsp;", " ")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&");
    }

    private static boolean isValidHttpUrl(String value) {
        if (value == null) {
            return false;
        }
        String trimmed = value.strip().toLowerCase(Locale.ROOT);
        return trimmed.startsWith("https://") || trimmed.startsWith("http://");
    }

    private static String truncate(String value, int maxLen) {
        if (value == null) {
            return "";
        }
        String trimmed = value.strip();
        if (trimmed.length() <= maxLen) {
            return trimmed;
        }
        return trimmed.substring(0, maxLen - 1).strip() + "…";
    }
}
