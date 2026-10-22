ALTER TABLE member DROP CONSTRAINT member_status_check;
ALTER TABLE member ADD CONSTRAINT member_status_check CHECK(status IN ('ACTIVE','WITHDRAWING','WITHDRAWN'));
ALTER TABLE member ALTER COLUMN nickname DROP NOT NULL;
UPDATE member SET status='WITHDRAWING',withdrawn_at=NULL WHERE status='WITHDRAWN' AND id IN (SELECT member_id FROM member_withdrawal WHERE status='PENDING');
-- Legacy active 9-12 character names remain valid historical data.
ALTER TABLE member ALTER COLUMN terms_agreed_at DROP NOT NULL;
ALTER TABLE member ALTER COLUMN privacy_agreed_at DROP NOT NULL;
UPDATE member SET nickname=NULL,profile_message='',terms_agreed_at=NULL,privacy_agreed_at=NULL WHERE status='WITHDRAWN';
ALTER TABLE member ADD CONSTRAINT member_profile_state CHECK (
 (status IN ('ACTIVE','WITHDRAWING') AND nickname IS NOT NULL AND char_length(btrim(nickname))>0)
 OR (status='WITHDRAWN' AND nickname IS NULL AND profile_message=''));
ALTER TABLE member_withdrawal ADD COLUMN confirmation_version VARCHAR(64);
ALTER TABLE member_withdrawal ADD COLUMN confirmed_at TIMESTAMPTZ;
-- Re-deliver old pending withdrawals; Trading acknowledgement must precede final privacy cleanup.
DELETE FROM oauth_identity WHERE member_id IN (SELECT id FROM member WHERE status='WITHDRAWN');
DELETE FROM refresh_session WHERE member_id IN (SELECT id FROM member WHERE status='WITHDRAWN');
CREATE TABLE policy_version (
 policy_type VARCHAR(16) NOT NULL CHECK(policy_type IN ('TERMS','PRIVACY')),
 version VARCHAR(64) NOT NULL,
 required BOOLEAN NOT NULL,
 current BOOLEAN NOT NULL,
 document_text TEXT NOT NULL,
 document_sha256 VARCHAR(64) NOT NULL CHECK(length(document_sha256)=64),
 PRIMARY KEY(policy_type,version)
);
CREATE UNIQUE INDEX policy_one_current ON policy_version(policy_type) WHERE current;
INSERT INTO policy_version VALUES
('TERMS','ym-terms-v1',true,true,$terms$# 요기망치 개발용 이용약관 (ym-terms-v1)
이 문서는 개발 단계의 기능·동의 계약 초안이다. 공개 운영 전 운영자, 문의 경로, 시행일을 확정하고 검토해야 한다.

요기망치는 가상자산 정보와 모의투자를 제공한다. 커뮤니티·대회 등 예정 기능은 실제 제공될 때 별도 안내한다. 실제 거래소 주문을 대행하지 않는다.
Google 또는 Kakao로 본인을 확인한 후 닉네임을 등록하고 이용약관 및 개인정보 수집·이용에 필수 동의하여 가입한다. 이메일만 같은 계정은 자동 연결하지 않는다.
모의투자의 USDT와 자산은 서비스 내부 가상 수치다. 실제 자산이 아니며 현금으로 환전·출금할 수 없다. 투자 결과와 시세 제공의 완전성·수익을 보장하지 않는다.
신규 회원은 1회차를 10,000 USDT로 시작한다. 반복 로그인은 자금을 다시 지급하지 않는다. 기존 Guest 체험과 회원 계정의 이력은 자동 합치지 않는다.
회원은 동일 회원 ID로 모의투자를 다시시작할 수 있다. 직전 성공한 다시시작부터 정확히 24시간이 지나야 다음 다시시작이 가능하다. 가입 시 최초 회차 생성은 이 제한에 포함하지 않는다.
다시시작은 기존 미체결 주문 취소, 포지션 관리상 종료, 새 회차 10,000 USDT 시작을 원자적으로 수행한다. 실제 체결·실현손익·수수료를 새로 만들지 않는다. 이전 회차 원장과 종료 자금은 보존한다.
오류·자동화·허위 주문을 악용하거나 다른 사용자 정보를 침해하는 행위를 금지한다. 관련 계정의 기능을 제한하거나 장애 복구를 위해 서비스를 일시 중단할 수 있다. 장애를 성공한 거래로 위장하지 않는다.
커뮤니티가 제공될 경우 타인 침해·불법·도배 콘텐츠를 제한한다. 탈퇴하더라도 게시글·댓글·대댓글 본문과 작성자 ID 참조는 유지하고 표시 이름은 탈퇴한회원으로 처리한다. 현재 이 Backend 변경은 커뮤니티를 구현하지 않는다.
탈퇴는 본인 JWT, 최근 동일 소셜 계정 인증, 안내 확인, 탈퇴합니다 문구와 안내 버전을 검증한다. Trading의 주문 취소·포지션 관리상 종료 확인 전에는 처리 중이며 완료로 표시하지 않는다.
탈퇴 완료 후 기존 회원 계정은 복구하지 않는다. 닉네임·프로필·이메일·소셜 연결 및 불필요한 인증/동의 정보는 제거한다. 필요한 과거 거래 원장과 비식별 ID 참조는 정합성을 위해 유지한다.
같은 Google/Kakao 계정으로 다시 가입할 수 있으나 새 동의와 닉네임으로 새로운 회원 ID를 받는다. 이전 자산·회차·거래 기록을 새 계정으로 옮기지 않는다.
변경 정책은 새 버전으로 안내한다. 필요한 변경은 재동의를 요청하며 과거 동의를 덮어쓰지 않는다. 실제 운영 문의 경로와 변경 공지 기간·시행일은 운영 전 확정·공개한다.
$terms$,'2f8a92dcec59e5e9207680824b94ff5d89053ccb42649e01911cee3f71d30824'),
('PRIVACY','ym-privacy-v1',true,true,$privacy$# 요기망치 개발용 개인정보 고지·수집 이용 동의 (ym-privacy-v1)
개발 단계 초안이다. 실제 운영자·개인정보 보호 담당자·문의처, 배포/위탁/국외 처리 현황, 로그 보유기간과 시행일은 아직 확정되지 않았으며 공개 운영 전에 확정·고지해야 한다. 확인되지 않은 업체명이나 법정 보존기간을 약속하지 않는다.

[수집·이용 동의 고지]
목적: Google/Kakao 회원 식별, 가입·인증·계정 관리, 공개 프로필·팔로우 기능, 서비스 내부 모의투자 계정 구분과 보안 및 장애 복구.
필수 항목: 소셜 제공자 종류와 제공자 회원 식별값, 확인된 이메일, 닉네임, 회원 ID, 약관/개인정보 동의 버전과 서버 시각, 가입·계정 상태. 이메일로 서로 다른 계정을 자동 연결하지 않는다.
선택 항목: 사용자가 입력한 프로필 메시지. 현재 프로필 이미지 업로드·이미지 파일 저장은 구현되어 있지 않다.
인증 처리: 자체 JWT와 해시화된 Refresh 인증 기록을 처리한다. Google/Kakao Access Token은 신원 확인에 일시 사용하며 영속 저장하지 않는다. OAuth state/nonce, 제공자 신원 증명 및 CSRF는 임시 세션에서 처리한다. 증명은5분, 회원 Access는15분, Refresh는 최초 발급부터 고정7일이다.
보유: 회원 프로필·소셜 연결은 가입 상태 동안 사용하고 탈퇴 완료 시 제거한다. 불필요한 Refresh·동의 기록과 기존 동의 시각도 제거한다. 처리 중 장애가 있으면 Trading 차단 확인과 안전한 파기 완료를 재시도하며 완료 전까지 상태를 구분한다.
동의를 거부할 수 있으나 필수 동의를 거부하면 회원가입과 회원 전용 기능을 제공할 수 없다. 공개 정보나 Guest 체험의 실제 제공 범위는 별도 API 계약을 따른다.

[개인정보 처리방침 고지]
회원 ID·탈퇴 상태·탈퇴 시각·필요한 최소 확인 버전/시각과 과거 거래 원장은 관계 및 정합성 유지를 위해 남긴다. 개인정보 파기를 이유로 Order/Fill/Position 등을 연쇄 삭제하지 않는다. 별도 법정 보존 필요성이 확인되지 않은 소셜 식별값30일 보관 등의 정책은 적용하지 않는다.
탈퇴 후 닉네임·프로필 메시지·이메일·소셜 제공자 식별값은 일반 회원 DB에서 제거하고 예전 회원 계정을 재활성화하지 않는다. 동일 소셜 계정 재가입은 별개의 새 회원이며 이전 이력을 합치지 않는다.
보안·장애 분석을 위한 애플리케이션 로그와 운영 환경의 접속 로그가 발생할 수 있다. 비밀번호·OAuth/JWT/Refresh 원문·불필요한 개인정보를 로그에 남기지 않는다. 실제 로그 항목·보유기간·삭제 절차와 백업 접근/파기 절차는 운영 전 점검·확정한다. 백업을 즉시 전부 지웠다고 주장하지 않는다.
Content와 Trading은 필요한 memberId 및 서명된 서비스 요청으로 통신하고 서로의 DB를 직접 읽거나 수정하지 않는다. Google/Kakao 인증, 실제 운영 클라우드의 위탁·국외 처리 현황은 운영 확정 후 구체적으로 고지한다. 현재 특정 위탁 업체나 국외 보관 위치를 확정하지 않는다.
프로필 확인·정정은 본인 API로, 서비스 이용 종료는 본인 확인 탈퇴 API로 요청한다. 추가 열람·정정·삭제·처리정지 문의와 개인정보 보호 담당 연락 경로는 운영 전에 공개한다.
개인정보 고지의 공개와 수집·이용 동의 기록은 별개다. 공개 문서를 읽는 것만으로 동의로 간주하지 않는다. 변경 시 새 문서 버전과 시행일을 알리고 필요한 재동의를 받는다.
$privacy$,'d9cd256759886f4de98ea6779fc783c9a1edfc8282a583626075e1b026ff34aa');
CREATE TABLE member_consent_history (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 member_id BIGINT NOT NULL REFERENCES member(id),
 policy_type VARCHAR(16) NOT NULL,
 policy_version VARCHAR(64) NOT NULL,
 accepted BOOLEAN NOT NULL CHECK(accepted),
 agreed_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(policy_type,policy_version) REFERENCES policy_version(policy_type,version),
 UNIQUE(member_id,policy_type,policy_version)
);
-- No fabricated versioned consents for existing members.
CREATE TABLE member_trading_provision (
 member_id BIGINT PRIMARY KEY REFERENCES member(id),
 status VARCHAR(16) NOT NULL CHECK(status IN ('PENDING','COMPLETED','CANCELED')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX member_provision_pending ON member_trading_provision(next_attempt_at,member_id) WHERE status='PENDING';
-- Existing account/member funding is not inferred. Only subsequent signups enqueue initial provisioning.

-- Canonicalize text bytes independently of the migration checkout line endings.
UPDATE policy_version SET document_text=replace(document_text,chr(13)||chr(10),chr(10));
CREATE FUNCTION immutable_policy_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.policy_type IS DISTINCT FROM OLD.policy_type OR NEW.version IS DISTINCT FROM OLD.version OR NEW.document_text IS DISTINCT FROM OLD.document_text OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256 THEN
  RAISE EXCEPTION 'Existing policy versions and documents are immutable; append a new version';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER policy_document_immutable BEFORE UPDATE ON policy_version FOR EACH ROW EXECUTE FUNCTION immutable_policy_document();
