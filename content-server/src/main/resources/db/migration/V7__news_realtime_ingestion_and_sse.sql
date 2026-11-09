ALTER TABLE news_article
    ADD COLUMN section VARCHAR(16) NOT NULL DEFAULT 'BREAKING' CHECK (section IN ('BREAKING', 'NEWSROOM')),
    ADD COLUMN sub_category VARCHAR(24) NOT NULL DEFAULT 'COIN_FLASH' CHECK (sub_category IN ('COIN_FLASH', 'ECONOMY_FLASH', 'CRYPTO', 'STOCKS', 'FX_RATES')),
    ADD COLUMN external_hash VARCHAR(64),
    ADD COLUMN source_url VARCHAR(1000),
    ADD COLUMN thumbnail_url VARCHAR(1000),
    ADD COLUMN ai_summary VARCHAR(400),
    ADD COLUMN sentiment VARCHAR(12) NOT NULL DEFAULT 'NEUTRAL' CHECK (sentiment IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
    ADD COLUMN bull_count INTEGER NOT NULL DEFAULT 0 CHECK (bull_count >= 0),
    ADD COLUMN bear_count INTEGER NOT NULL DEFAULT 0 CHECK (bear_count >= 0),
    ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0);

CREATE UNIQUE INDEX news_article_external_hash_uidx ON news_article(external_hash) WHERE external_hash IS NOT NULL;
CREATE INDEX news_article_section_sub_published_idx ON news_article(section, sub_category, id DESC);
CREATE INDEX news_article_popular_idx ON news_article((bull_count + bear_count + view_count) DESC, id DESC);

UPDATE news_article
SET section = 'NEWSROOM',
    sub_category = 'CRYPTO',
    external_hash = 'seed-v5-btc-onchain-holder-lock',
    source_url = 'https://news.google.com/rss/search?q=BTC+onchain&hl=ko&gl=KR&ceid=KR:ko',
    ai_summary = '[AI 강세 분석] #BTC 장기 보유 지갑의 물량 잠김과 거래소 잔고 감소가 맞물리며 매도 압력이 완화되고 있습니다. 현물 매수세 유입 시 호가 탄력성을 함께 점검하세요.',
    sentiment = 'BULLISH',
    bull_count = 42,
    bear_count = 8,
    view_count = 310
WHERE title LIKE '비트코인 장기 보유자%';

UPDATE news_article
SET section = 'NEWSROOM',
    sub_category = 'CRYPTO',
    external_hash = 'seed-v5-xrp-regulation-custody',
    source_url = 'https://news.google.com/rss/search?q=XRP+custody&hl=ko&gl=KR&ceid=KR:ko',
    ai_summary = '[AI 강세 분석] #XRP 글로벌 기관 수탁 및 준비금 증명 표준화로 기관 유동성 유입 여건이 개선되고 있습니다. 규제 불확실성 해소 여부를 주시하세요.',
    sentiment = 'BULLISH',
    bull_count = 29,
    bear_count = 6,
    view_count = 195
WHERE title LIKE '글로벌 가상자산 이용자 보호%';

UPDATE news_article
SET section = 'BREAKING',
    sub_category = 'COIN_FLASH',
    external_hash = 'seed-v5-sol-dex-funding-neutral',
    source_url = 'https://news.google.com/rss/search?q=SOL+DEX&hl=ko&gl=KR&ceid=KR:ko',
    ai_summary = '[AI 강세 분석] #SOL DEX 거래 대금이 견조한 가운데 과열됐던 롱 포지션 펀딩비가 중립권으로 회귀하며 레버리지 부담이 완화되었습니다.',
    sentiment = 'BULLISH',
    bull_count = 37,
    bear_count = 11,
    view_count = 264
WHERE title LIKE '솔라나 네트워크 DEX%';

UPDATE news_article
SET section = 'BREAKING',
    sub_category = 'COIN_FLASH',
    external_hash = 'seed-v5-eth-l2-staking-high',
    source_url = 'https://news.google.com/rss/search?q=ETH+Layer2&hl=ko&gl=KR&ceid=KR:ko',
    ai_summary = '[AI 강세 분석] #ETH 레이어2 일간 처리량 최고치 경신과 안정적인 스테이킹 예치율이 중장기 네트워크 수급 구조를 뒷받침하고 있습니다.',
    sentiment = 'BULLISH',
    bull_count = 34,
    bear_count = 9,
    view_count = 240
WHERE title LIKE '이더리움 레이어2 일간 처리량%';

UPDATE news_article
SET section = 'BREAKING',
    sub_category = 'ECONOMY_FLASH',
    external_hash = 'seed-v5-macro-fed-dxy-yield',
    source_url = 'https://news.google.com/rss/search?q=FOMC+DXY&hl=ko&gl=KR&ceid=KR:ko',
    ai_summary = '[AI 약세 주의] 연준 통화정책 경계감과 국채 금리 변동성 확대로 거시 지표 발표 전후 격리마진 및 레버리지 리스크 관리가 요구됩니다.',
    sentiment = 'BEARISH',
    bull_count = 14,
    bear_count = 31,
    view_count = 285
WHERE title LIKE '미 연준 통화정책 신중론%';

UPDATE news_article
SET section = 'BREAKING',
    sub_category = 'COIN_FLASH',
    external_hash = 'seed-v5-btc-spot-inflow-oi',
    source_url = 'https://news.google.com/rss/search?q=BTC+open+interest&hl=ko&gl=KR&ceid=KR:ko',
    ai_summary = '[AI 강세 분석] #BTC 기관 자금 순유입 재개와 건전한 선물 콘탱고 베이시스가 맞물리며 현물 주도 하방 경직성이 강화되고 있습니다.',
    sentiment = 'BULLISH',
    bull_count = 58,
    bear_count = 12,
    view_count = 420
WHERE title LIKE '비트코인 현물 ETF%';

INSERT INTO news_article (
    category, section, sub_category, external_hash, title, summary, content,
    source_name, source_url, thumbnail_url, ai_summary, sentiment,
    bull_count, bear_count, view_count, symbol_tag, published_at
) VALUES
('MACRO', 'BREAKING', 'ECONOMY_FLASH', 'seed-v7-economy-flash-cpi-nasdaq',
 '미 근원 물가 지표 발표 앞두고 나스닥 선물 및 가상자산 동조화 흐름 심화',
 '소비자물가와 고용 지표 발표를 앞두고 미국 기술주 선물과 주요 디지털 자산 간 단기 상관계수가 높아지고 있습니다.',
 '거시경제 주요 물가 지표 발표를 앞두고 나스닥 100 선물과 주요 암호화폐 시장의 단기 동조화 현상이 뚜렷해지고 있습니다. 금리 선물 시장의 기준금리 경로 반영 변화에 따라 위험자산 전반의 장중 변동성이 커질 수 있어 주의가 필요합니다.\n\n[출처: 요기망치 매크로 인사이트] 본 기사는 공개 RSS 메타데이터 기반 요약 브리핑이며, 전체 기사 전문은 언론사 원문 링크에서 확인하실 수 있습니다.',
 '요기망치 매크로 인사이트', 'https://news.google.com/rss/search?q=CPI+Nasdaq&hl=ko&gl=KR&ceid=KR:ko', NULL,
 '[AI 시장 브리핑] 거시 물가 지표 발표 직후 나스닥 선물과 코인 선물 간 변동성 전이가 빠르므로 손절가 설정을 권장합니다.',
 'NEUTRAL', 22, 19, 215, NULL, now() - interval '90 minutes'),
('MACRO', 'NEWSROOM', 'STOCKS', 'seed-v7-newsroom-stocks-ai-semiconductor',
 '뉴욕증시 AI 반도체 및 클라우드 실적 호조에 S&P500·나스닥 위험선호 심리 회복',
 '글로벌 빅테크와 AI 반도체 기업들의 데이터센터 투자 확대가 확인되면서 뉴욕증시 기술주 중심의 매수 심리가 개선되고 있습니다.',
 '뉴욕증시에서 AI 인프라 및 클라우드 반도체 섹터의 실적 가이던스가 시장 기대치를 상회하며 S&P500과 나스닥 지수의 투자심리가 회복세를 보이고 있습니다. 글로벌 위험자산 선호 심리가 개선됨에 따라 디지털 자산 시장으로의 유동성 확산 여부도 주목받고 있습니다.\n\n[출처: 요기망치 글로벌 증시 데스크] 본 기사는 공개 RSS 메타데이터 기반 요약 브리핑이며, 전체 기사 전문은 언론사 원문 링크에서 확인하실 수 있습니다.',
 '요기망치 글로벌 증시 데스크', 'https://news.google.com/rss/search?q=S%26P500+Nasdaq&hl=ko&gl=KR&ceid=KR:ko', NULL,
 '[AI 강세 분석] 뉴욕증시 기술주 강세와 위험선호 회복은 야간 시간대 암호화폐 선물 수급에도 긍정적 모멘텀으로 작용할 수 있습니다.',
 'BULLISH', 46, 10, 330, NULL, now() - interval '75 minutes'),
('MACRO', 'NEWSROOM', 'FX_RATES', 'seed-v7-newsroom-fx-krw-ust10y',
 '원·달러 환율 및 미 10년물 국채금리 숨고르기… 글로벌 달러 유동성 지표 점검',
 '미국채 10년물 금리 상승세가 진정 국면에 접어들면서 원·달러 환율과 주요 신흥국 통화 변동성이 완화되는 흐름입니다.',
 '글로벌 외환 및 채권 시장에서 미 10년물 국채 수익률의 가파른 상승세가 진정되며 달러 인덱스와 원·달러 환율이 박스권 등락을 이어가고 있습니다. 실질금리 부담 완화는 무이자 위험자산 및 가상자산 밸류에이션 부담을 낮추는 요인으로 평가됩니다.\n\n[출처: 요기망치 외환·채권 데스크] 본 기사는 공개 RSS 메타데이터 기반 요약 브리핑이며, 전체 기사 전문은 언론사 원문 링크에서 확인하실 수 있습니다.',
 '요기망치 외환·채권 데스크', 'https://news.google.com/rss/search?q=USD+KRW+bond&hl=ko&gl=KR&ceid=KR:ko', NULL,
 '[AI 시장 브리핑] 미국채 10년물 금리와 달러 인덱스 안정 여부는 주말·야간 선물 시장 유동성 판단의 핵심 지표입니다.',
 'NEUTRAL', 25, 16, 180, NULL, now() - interval '45 minutes');
