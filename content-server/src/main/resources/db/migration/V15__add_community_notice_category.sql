ALTER TABLE community_post DROP CONSTRAINT IF EXISTS community_post_category_check;

ALTER TABLE community_post
    ADD CONSTRAINT community_post_category_check
    CHECK (category IN ('MARKET', 'ANALYSIS', 'POSITION', 'FREE', 'NOTICE'));
