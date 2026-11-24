-- V12: Member suspension/ban & OAuth ban list, community report status & post view_count,
--      idempotent news reactions, finalized PUBLISHED V2 policies, and 1:1 support inquiries.

-- 1. Member suspension/ban status support & banned OAuth identity registry
ALTER TABLE member DROP CONSTRAINT member_status_check;
ALTER TABLE member ADD CONSTRAINT member_status_check
    CHECK (status IN ('ACTIVE', 'WITHDRAWING', 'WITHDRAWN', 'SUSPENDED', 'BANNED'));

ALTER TABLE member DROP CONSTRAINT member_profile_state;
ALTER TABLE member ADD CONSTRAINT member_profile_state CHECK (
    (status IN ('ACTIVE', 'WITHDRAWING', 'SUSPENDED', 'BANNED') AND nickname IS NOT NULL AND char_length(btrim(nickname)) > 0)
    OR (status = 'WITHDRAWN' AND nickname IS NULL AND profile_message = '')
);

ALTER TABLE member
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(500);

CREATE TABLE banned_oauth_identity (
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    reason VARCHAR(500),
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    banned_by_member_id BIGINT,
    PRIMARY KEY (provider, provider_subject)
);

-- 2. Community report moderation lifecycle & post view count
ALTER TABLE community_post_report
    ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'DISMISSED')),
    ADD COLUMN resolved_at TIMESTAMPTZ,
    ADD COLUMN resolved_by_member_id BIGINT REFERENCES member(id),
    ADD COLUMN resolution_note VARCHAR(500);

ALTER TABLE community_comment_report
    ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'DISMISSED')),
    ADD COLUMN resolved_at TIMESTAMPTZ,
    ADD COLUMN resolved_by_member_id BIGINT REFERENCES member(id),
    ADD COLUMN resolution_note VARCHAR(500);

CREATE INDEX community_post_report_status_idx ON community_post_report(status, created_at DESC);
CREATE INDEX community_comment_report_status_idx ON community_comment_report(status, created_at DESC);

ALTER TABLE community_post
    ADD COLUMN view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0);

-- 3. Idempotent news article reactions (create / switch / toggle-off per actor)
CREATE TABLE news_article_reaction (
    article_id BIGINT NOT NULL REFERENCES news_article(id) ON DELETE CASCADE,
    actor_key VARCHAR(128) NOT NULL,
    reaction_type VARCHAR(16) NOT NULL CHECK (reaction_type IN ('BULL', 'BEAR')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (article_id, actor_key)
);

-- 4. Finalized V2 policies (PUBLISHED)
ALTER TABLE policy_version
    ADD COLUMN document_status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED'
        CHECK (document_status IN ('DEVELOPMENT_DRAFT', 'PUBLISHED'));

UPDATE policy_version
SET document_status = 'DEVELOPMENT_DRAFT',
    current = false
WHERE version IN ('ym-terms-v1', 'ym-privacy-v1');

INSERT INTO policy_version (policy_type, version, required, current, document_text, document_sha256, document_status) VALUES
('TERMS', 'ym-terms-v2', true, true, replace($terms$# 요기망치 이용약관 (ym-terms-v2)
시행일: 2026-11-21 · 문서 상태: 확정(PUBLISHED)

제1조 (서비스 목적 및 범위)
요기망치는 가상 USDT를 이용한 암호화폐 무기한 선물 모의투자(시장가·지정가·격리마진·레버리지·손절/익절), 모의투자 대회(시즌 리더보드 및 정산), 실시간 경제·코인 뉴스 피드, 트레이더 커뮤니티(게시글·댓글·이미지 첨부·포지션 공유·신고), 회원 프로필·팔로우·알림 및 1:1 고객문의 기능을 제공합니다. 본 서비스는 실제 자금을 수탁하거나 외부 거래소 주문을 대행하지 않습니다.

제2조 (회원가입 및 계정 관리)
회원은 Google 또는 Kakao 소셜 인증으로 본인을 확인한 뒤 닉네임을 등록하고 이용약관 및 개인정보 처리방침에 필수 동의하여 가입합니다. 서로 다른 소셜 제공자 계정은 이메일 일치만으로 자동 연결하지 않으며, Guest 체험 이력은 회원 계정에 자동 병합되지 않습니다.

제3조 (모의투자 및 대회 운영 원칙)
모의투자의 USDT, 증거금, 손익 및 자산 수치는 서비스 내부 가상 수치이며 현금으로 환전·출금할 수 없습니다. 신규 회원은 1회차를 10,000 USDT로 시작하며 반복 로그인으로 자금이 중복 지급되지 않습니다. 동일 회원 ID의 다시시작은 직전 성공 시점으로부터 24시간 이후 가능하며, 미체결 주문 취소·포지션 관리상 종료·새 회차 10,000 USDT 시작을 원자적으로 처리하고 이전 회차 원장은 보존합니다. 모의투자 대회의 참가·집계·정산은 서버 시세 및 서버 원장 기록을 기준으로 합니다.

제4조 (커뮤니티 및 이용 제한)
회원은 커뮤니티에서 스팸·도배·음란물·불법정보·청소년 유해물·욕설/혐오·개인정보 노출·사기/허위정보 등 서비스 정책을 위반하는 게시물이나 댓글을 작성할 수 없으며, 시스템 오류·자동화·허위 주문을 악용할 수 없습니다. 운영자는 신고 접수 및 정책 위반 확인 시 게시물·댓글의 삭제(숨김), 계정 일시 정지(SUSPENDED), 강제 탈퇴 및 재가입 차단 조치를 취할 수 있으며 처리 결과를 알림과 신고 내역으로 안내합니다.

제5조 (회원 탈퇴 및 재가입)
회원은 본인 인증(Access JWT, 최근 동일 소셜 계정 OAuth 증명, CSRF 및 확인 문구)을 통해 탈퇴를 요청할 수 있습니다. Trading 서버의 미체결 주문 취소 및 포지션 정리 확인이 완료되면 탈퇴가 최종 확정되며 기존 계정은 복구되지 않습니다. 탈퇴 완료 시 커뮤니티에 작성한 게시글·댓글 본문은 유지되며 작성자 표시는 "탈퇴한회원"으로 익명화됩니다. 일반 탈퇴 회원은 동일 소셜 계정으로 새 회원 ID를 발급받아 재가입할 수 있으나 이전 자산·회차·거래 기록은 이관되지 않습니다. 단, 약관 위반으로 강제 탈퇴 및 차단된 소셜 계정은 부정 이용 방지를 위해 재가입이 제한됩니다.

제6조 (고객문의 및 약관 변경)
회원은 서비스 내 1:1 고객문의를 통해 서비스 이용 문의, 오류 제보 및 제재 이의 제기를 제출할 수 있습니다. 본 약관이 변경되는 경우 새로운 버전으로 공지하며, 중요한 변경 사항이 있는 경우 회원의 재동의를 요청합니다. 과거 동의 이력은 덮어쓰지 않고 버전별로 기록합니다.
$terms$, chr(13) || chr(10), chr(10)), 'd837fbdd31d567e35a834dbe76f8fc8cc28849504dd2d8a3239f7d7fa16f67ea', 'PUBLISHED'),
('PRIVACY', 'ym-privacy-v2', true, true, replace($privacy$# 요기망치 개인정보 처리방침 및 수집·이용 동의 (ym-privacy-v2)
시행일: 2026-11-21 · 문서 상태: 확정(PUBLISHED)

1. 개인정보 수집·이용 목적
요기망치는 Google/Kakao 회원 식별 및 로그인·인증, 세션 보안 및 부정 이용 방지, 공개 프로필·팔로우·실시간 알림 제공, 트레이더 커뮤니티(게시글·댓글·이미지 첨부·신고 처리), 모의투자 및 대회 계정 구분, 1:1 고객문의 접수 및 답변 전달, 장애 분석 및 서비스 안정성 유지를 위해 개인정보를 처리합니다.

2. 수집하는 개인정보 항목
- 필수 항목: 소셜 제공자 종류(Google/Kakao) 및 제공자 고유 식별값, 확인된 이메일, 닉네임, 회원 ID, 이용약관·개인정보 동의 버전 및 서버 동의 시각, 계정 상태.
- 선택 항목: 프로필 메시지, 프로필 이미지, 커뮤니티 첨부 이미지, 1:1 고객문의 카테고리·제목·내용.
- 자동 생성 정보: 서비스 이용·신고·알림 이력, 보안 및 장애 추적용 요청 식별자(X-Request-Id), 익명 조회·반응 중복 방지용 단방향 해시값.

3. 인증 토큰, 이미지 저장 및 서비스 간 데이터 분리
자체 RS256 Access JWT(유효기간 15분)와 PostgreSQL 해시 기반 회전형 HttpOnly Refresh Cookie(최초 발급 기준 고정 7일)를 사용합니다. Google/Kakao Access Token은 신원 확인 시 일시 사용하며 영속 저장하지 않습니다. 프로필·커뮤니티 이미지는 서비스 운영 설정에 따라 로컬 안전 저장소 또는 클라우드 객체 스토리지(S3)에 보관되며, 교체·삭제·탈퇴 시 정리 작업을 통해 파기합니다. Content 서버와 Trading 서버는 각자 스키마를 분리 소유하며 필요한 memberId와 서명된 내부 API로만 통신합니다.

4. 개인정보 보유·이용 기간 및 파기
회원 프로필(닉네임·프로필 메시지·프로필 이미지), 이메일, 소셜 연결, 알림 데이터 및 불필요한 인증·동의 기록은 회원 탈퇴 확정 시 지체 없이 파기합니다. 만료·폐기된 Refresh 세션과 완료·취소된 Trading 계정 프로비저닝 이력은 보존 주기(기본 30일) 경과 후 배치 정리합니다. 모의투자 정합성 유지를 위한 과거 주문·체결·회차 원장과 비식별 회원 ID 참조는 보존하며, 약관 위반으로 강제 탈퇴된 계정의 부정 재가입 방지를 위해 차단된 소셜 제공자 식별 정보 및 제재 사유를 보관할 수 있습니다.

5. 이용자의 권리 및 문의 경로
이용자는 필수 동의를 거부할 수 있으나, 거부 시 회원가입 및 회원 전용 기능 이용이 제한됩니다. 회원은 내 프로필 수정, 회원 탈퇴, 전체 기기 로그아웃 및 1:1 고객문의를 통해 개인정보 열람·정정·삭제·처리정지를 요청할 수 있습니다. 비밀번호·OAuth 토큰·Refresh 원문 등 민감 정보는 서버 로그에 기록하지 않으며, 처리방침 변경 시 새 버전으로 공개하고 필요한 재동의를 받습니다.
$privacy$, chr(13) || chr(10), chr(10)), 'a7e9acc4d04c51f534806c91f32fba2090017a8f285957e98624dc801c76617f', 'PUBLISHED');

-- 5. Lightweight 1:1 support inquiry loop
CREATE TABLE support_inquiry (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES member(id),
    category VARCHAR(32) NOT NULL,
    title VARCHAR(160) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ANSWERED')),
    admin_reply TEXT,
    replied_by_member_id BIGINT REFERENCES member(id),
    replied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX support_inquiry_member_idx ON support_inquiry(member_id, id DESC);
CREATE INDEX support_inquiry_status_idx ON support_inquiry(status, id DESC);
