CREATE TABLE IF NOT EXISTS news_article_member_view (
    news_id BIGINT NOT NULL REFERENCES news_article(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (news_id, member_id)
);

CREATE TABLE IF NOT EXISTS news_article_anon_daily_view (
    news_id BIGINT NOT NULL REFERENCES news_article(id) ON DELETE CASCADE,
    viewed_date DATE NOT NULL,
    viewer_hash VARCHAR(64) NOT NULL,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (news_id, viewed_date, viewer_hash)
);

CREATE INDEX IF NOT EXISTS news_article_anon_daily_view_date_idx
    ON news_article_anon_daily_view(viewed_date);

CREATE INDEX IF NOT EXISTS news_article_view_sort_idx
    ON news_article(view_count DESC, published_at DESC, id DESC);

UPDATE news_article
SET view_count = 0
WHERE external_hash LIKE 'seed-%';
