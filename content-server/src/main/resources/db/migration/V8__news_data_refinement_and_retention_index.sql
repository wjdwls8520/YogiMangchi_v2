CREATE INDEX news_article_retention_published_idx ON news_article(published_at, id) WHERE external_hash IS NOT NULL;

-- Clean up any previously ingested RSS rows that had repetitive title-prefix summaries
UPDATE news_article
SET summary = CASE sub_category
    WHEN 'ECONOMY_FLASH' THEN source_name || ' 긴급 타전으로 주요 거시 지표 및 정책 발언 직후 글로벌 달러와 나스닥·코인 선물이 즉각 반응하고 있습니다.'
    WHEN 'STOCKS' THEN source_name || ' 보도에 따르면 글로벌 빅테크 실적과 월가 기관 수급 변화가 뉴욕증시 및 위험자산 전반의 투자심리를 주도하고 있습니다.'
    WHEN 'FX_RATES' THEN source_name || ' 외환·채권 보도에 따르면 미국채 수익률과 원·달러 환율 흐름에 따라 글로벌 위험자산 유동성 여건이 재조정되고 있습니다.'
    WHEN 'CRYPTO' THEN source_name || ' 시황 보도에 따르면 주요 디지털 자산의 기관 수급과 온체인 활동 지표를 중심으로 중기 방향성 탐색이 이어지고 있습니다.'
    ELSE source_name || ' 속보에 따르면 주요 거래소 현·선물 호가창 거래대금 유입과 함께 단기 변동성이 빠르게 확대되고 있습니다.'
END
WHERE position(title || ' — ' in summary) = 1;

-- Clean up any rows whose content had duplicated summary/aiSummary or verbose legal footer
UPDATE news_article
SET content = CASE
    WHEN section = 'BREAKING' AND sub_category = 'ECONOMY_FLASH' THEN
        '거시 지표 발표 및 정책 발언 직후 나스닥 선물과 코인 선물 간 단기 변동성이 확대될 수 있으니 고배율 포지션의 청산가 여유폭을 점검하세요.'
    WHEN section = 'BREAKING' AND sentiment = 'BULLISH' THEN
        coalesce(symbol_tag || ' ', '주요 종목 ') || '단기 매수 수급 유입 구간으로 주요 저항선 돌파 시 거래량 동반 여부와 무기한 선물 펀딩비 과열 여부를 실시간 확인하세요.'
    WHEN section = 'BREAKING' AND sentiment = 'BEARISH' THEN
        coalesce(symbol_tag || ' ', '주요 종목 ') || '단기 매물 출회 및 변동성 확대 구간으로 직전 지지선 방어 여부와 격리마진 손절 라인을 즉시 점검하세요.'
    WHEN section = 'BREAKING' THEN
        coalesce(symbol_tag || ' ', '주요 종목 ') || '현·선물 호가창 유동성과 미결제약정(OI) 증감을 함께 확인하며 단기 방향성 돌파에 대비하세요.'
    WHEN sub_category = 'STOCKS' THEN
        '뉴욕증시 주요 지수와 AI·반도체 빅테크 섹터의 실적 흐름은 글로벌 위험자산 투자심리를 가늠하는 핵심 선행 지표로 작용하고 있습니다. 미 정규장 개장 전후 나스닥 100 선물 흐름과 디지털 자산 시장 간 동조화 강도를 비교하며 포지션 비중을 조절할 필요가 있습니다.'
    WHEN sub_category = 'FX_RATES' THEN
        '미국채 10년물 실질금리와 달러 인덱스(DXY), 원·달러 환율의 방향성은 글로벌 유동성 여건과 위험자산 자금 유입 속도를 결정짓는 핵심 변수입니다. 통화정책 경로에 대한 금리 선물 시장의 기대 변화를 주시하며 거시 변동성 구간에서의 레버리지 리스크를 관리해야 합니다.'
    ELSE
        '디지털 자산 시장은 기관 현물 수급과 파생상품 미결제약정(OI) 변화가 맞물리며 중기 추세 탐색을 이어가고 있습니다. 온체인 장기 보유 지갑의 물량 이동 추이와 주요국 규제·인프라 정비 흐름을 함께 점검하며 분할 대응 전략을 유지하시기 바랍니다.'
END
WHERE content LIKE '%본 기사는 공개 RSS 메타데이터 기반%'
   OR content LIKE '%[출처:%';

INSERT INTO news_article (
    category, section, sub_category, external_hash, title, summary, content,
    source_name, source_url, thumbnail_url, ai_summary, sentiment,
    bull_count, bear_count, view_count, symbol_tag, published_at
) VALUES
('MACRO', 'BREAKING', 'ECONOMY_FLASH', 'seed-v8-economy-flash-us-jobless-claims',
 '미 주간 신규 실업수당 청구 건수 예상치 하회… 고용 시장 견조세 유지',
 '미국 노동부 발표 주간 실업수당 청구 건수가 시장 예상치를 밑돌며 국채 금리와 나스닥 선물이 즉각 반응하고 있습니다.',
 '고용 지표 호조에 따른 미국채 단기물 금리 움직임과 달러 인덱스 반응이 코인 선물 단기 방향성에 영향을 줄 수 있으니 주의하세요.',
 '요기망치 경제속보 데스크', 'https://news.google.com/rss/search?q=US+jobless+claims&hl=ko&gl=KR&ceid=KR:ko', NULL,
 '[AI 시장 브리핑] 고용 지표 발표 직후 금리 선물 변동성이 확대되는 구간으로 단기 레버리지 포지션 관리에 유의하세요.',
 'NEUTRAL', 19, 17, 198, NULL, now() - interval '55 minutes'),
('MACRO', 'NEWSROOM', 'STOCKS', 'seed-v8-newsroom-stocks-wallstreet-tech-flows',
 '월가 기관 자금 대형 기술주 및 데이터센터 인프라 섹터로 순유입 지속',
 '글로벌 자산운용사들의 분기 포트폴리오 리밸런싱 과정에서 클라우드·전력망·반도체 핵심 종목군으로의 자금 유입이 이어지고 있습니다.',
 '뉴욕증시에서 실적 가시성이 높은 빅테크와 AI 전력 인프라 기업들을 중심으로 기관 매수세가 유입되며 지수 하방 경직성을 높이고 있습니다. 미 증시 위험선호 심리가 견조하게 유지될 경우 야간 시간대 디지털 자산 선물 시장의 매수 심리에도 우호적인 환경이 조성될 수 있습니다.',
 '요기망치 글로벌 증시 데스크', 'https://news.google.com/rss/search?q=Wall+Street+tech+flows&hl=ko&gl=KR&ceid=KR:ko', NULL,
 '[AI 강세 분석] 글로벌 기관의 위험자산 비중 확대 흐름은 가상자산 시장의 중기 수급 여건에도 긍정적인 시그널입니다.',
 'BULLISH', 38, 9, 275, NULL, now() - interval '40 minutes'),
('MACRO', 'NEWSROOM', 'FX_RATES', 'seed-v8-newsroom-fx-dxy-global-liquidity',
 '글로벌 주요 통화 대비 달러 인덱스 혼조세… 한·미 금리차 및 외환 수급 분석',
 '주요국 중앙은행들의 통화정책 차별화 속도가 조절되면서 달러 인덱스(DXY)와 원·달러 환율이 좁은 범위 내 등락을 거듭하고 있습니다.',
 '외환 시장에서 결제 수요와 외국인 증시 자금 흐름이 맞물리며 원·달러 환율의 상단이 제한되는 모습을 보이고 있습니다. 글로벌 달러 유동성 지표와 미국채 장단기 금리차 추이는 주말 및 야간 암호화폐 파생상품 시장의 변동성 판단에 중요한 참고 지표가 됩니다.',
 '요기망치 외환·채권 데스크', 'https://news.google.com/rss/search?q=DXY+KRW+rate+analysis&hl=ko&gl=KR&ceid=KR:ko', NULL,
 '[AI 시장 브리핑] 환율과 국채금리가 안정권에 머무는 동안에는 개별 코인의 온체인·선물 수급 요인이 가격을 주도할 가능성이 높습니다.',
 'NEUTRAL', 21, 14, 165, NULL, now() - interval '25 minutes')
ON CONFLICT (external_hash) WHERE external_hash IS NOT NULL DO NOTHING;
