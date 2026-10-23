# Yogimangchi V2 운영 체크리스트

공개 운영 전후의 확인 항목이다. 문서 생성은 배포나 검증 완료를 의미하지 않는다.
모든 항목은 미완료로 시작하며 실제 해결 후에만 체크하고 완료일, 관련 PR, 검증 결과를 기록한다.
검증 결과에는 환경·커밋·실행 절차·관측 결과 또는 접근 통제된 증빙 위치를 남긴다.
비밀번호, 개인키, JWT, OAuth/Refresh Token, 회원 개인정보를 증빙에 넣지 않는다.
운영 환경에 적용되지 않은 로컬/임시 DB 테스트를 운영 검증 완료로 기록하지 않는다.

## 배포 및 외부 접근

- [ ] OPS-01 — EC2/VPS와 운영 Docker Compose 준비
  - Content/Trading을 독립 컨테이너로 구성하고 이미지 버전, Java 17, Spring Boot 3.5.x, 재시작·정상 종료·자원 제한·디스크 용량을 확인한다. 공용 Compose는 루트에서 관리하고 현재 로컬 PostgreSQL/Redis 구성과 운영 배포 구성을 구분한다. 방화벽·보안 그룹·SSH 접근을 점검하고 PostgreSQL/Redis를 외부에 공개하지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-02 — Nginx, 도메인, HTTPS와 WebSocket 경로 검증
  - 인증서 발급·갱신, HTTP→HTTPS, Content/Trading 라우팅, WebSocket Upgrade, 허용 요청 크기·연결 제한을 확인한다. 신뢰 프록시에서만 forwarded header를 받도록 하고 OAuth redirect URI가 외부 HTTPS 주소와 일치하는지 확인한다. 운영 Swagger/OpenAPI 외부 차단도 검증한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-03 — Vercel ↔ Backend 쿠키·CORS·OAuth 연동
  - 현재 SameSite=Lax 계약에 맞는 같은 사이트의 Frontend/API 사용자 도메인을 준비한다. 별개 사이트의 vercel.app/API 조합이나 제3자 쿠키 허용에 의존하지 않는다. credentials:include, 정확한 CORS origin, CSRF 세션, Secure/HttpOnly/Path 속성과 Google/Kakao 등록 callback을 실제 브라우저에서 확인한다. Preview 도메인을 임의의 wildcard로 열지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

## 배포 자동화 및 복구

- [ ] OPS-04 — 서비스별 GitHub Actions CI/CD와 배포 권한 점검
  - Content/Trading/infra 변경을 각각의 브랜치·커밋·PR로 관리하고 필요한 테스트와 빌드를 실행한다. 배포 이미지의 커밋·태그·대상 환경을 추적하고 PR 검증과 배포 자격증명을 분리한다. master/develop 보호 범위, 직접 푸시 차단, Actions 최소 권한, 중복 배포 방지와 수동 승인 범위를 확정한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-05 — 배포 순서와 애플리케이션/DB 롤백 리허설
  - 기존 writer를 중지하고 백업한 뒤 의존하는 Trading migration·API를 먼저, Content migration·API를 다음에 적용한다. Flyway validate와 Hibernate validate를 확인한다. 구버전의 회원 0잔액 생성 코드가 새 회차 구조를 우회하지 않도록 한다. 실패 시 앱 버전 복귀와 DB 복원을 구분하며 개인정보 파기·재가입·거래 이력이 있는 상태의 무조건적인 과거 DB 복원을 피한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-06 — PostgreSQL 백업과 실제 복원 검증
  - 정기 백업, 별도 저장 위치, 암호화·접근 권한·보관/파기 기간과 담당자를 정한다. 운영 DB에 덮어쓰지 않는 격리된 환경에서 복원하고 스키마·Flyway 이력·회원/거래 건수·잔액/노출 정합성, 복구 소요 시간과 허용 데이터 손실 범위를 확인한다. Volume 존재나 dump 파일 생성만으로 복구 가능하다고 판단하지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-07 — DB 소유권·계정 권한과 운영 migration 검증
  - 공용 yogimangchi DB와 content/trading Schema 소유권을 유지한다. 각 서비스의 앱/전용 Flyway 계정을 분리하고 필요한 테이블·시퀀스·함수 권한만 부여한다. 다른 서비스 Schema 직접 접근 금지와 ddl-auto=validate, open-in-view=false, 기존 migration checksum 보존을 확인한다. 기존 회원 자금을 일괄 초기화하거나 지급하지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

## 인증 및 개인정보

- [ ] OPS-08 — 운영 비밀키·환경변수와 키 교체 절차
  - 실제 RSA 개인키·OAuth Secret·DB/Redis 비밀번호를 저장소·이미지·빌드 로그에 넣지 않는다. Content 서명키/issuer와 Trading 공개키의 일치를 확인하고 키 교체 시 기존 15분 Access 유효 시간과 배포 순서를 검증한다. Secret 접근·폐기·유출 대응 책임을 정한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-09 — 브라우저 Refresh Lock 호환성과 활성 탭 정책
  - 대상 브라우저와 HTTPS에서 navigator.locks 지원을 확인한다. 같은 쿠키를 쓰는 가입·로그인 완료·Refresh·로그아웃·탈퇴를 응답 처리까지 같은 origin Lock으로 직렬화하고 동일 탭 중복 Refresh를 하나로 합친다. 비활성 탭의 주기적 갱신을 제거하고 복귀/실제 요청 때 만료를 확인한다. 미지원 브라우저에서는 검증 없는 병렬 Refresh로 대체하지 않고 지원 범위나 별도 검증된 대안을 확정한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-10 — Refresh 회전·실패 응답과 세션 종료 검증
  - 15분 Access·고정 7일 Refresh·해시 저장·재사용 시 계열 폐기·CSRF를 유지한다. 지연된 401이 새 쿠키를 지우지 않는지, 이전 세대의 응답이 새 로그인 상태를 덮지 않는지 확인한다. 응답 유실 뒤 구 Refresh를 무조건 재전송하지 않는다. 로그아웃·회전·탈퇴 경합과 기기별 계열 분리, 전체 계열 탈퇴 폐기를 실제 브라우저/서버 조합으로 검증한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-11 — 회원 가입·거래·재시작·탈퇴·재가입 통합 검증
  - 실제 Google/Kakao 로그인부터 회원 최초 10000 USDT의 멱등한 지급, 서버 Mark 주문/체결, 24시간 재시작·과거 원장 보존을 확인한다. WITHDRAWING→Trading 정리→WITHDRAWN 이후 구 JWT로 계정 생성·조회·주문이 불가능한지 검증한다. 재가입은 새 회원 ID이며 Guest와 이전 회원 자금/이력을 합치지 않는지 확인한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-12 — 공개 전 이용약관·개인정보처리방침 확정
  - DEVELOPMENT_DRAFT를 운영 확정본으로 오인하지 않는다. 실제 운영자·문의처·개인정보 담당자, 수집 목적/항목, 위탁·국외 처리, 보유/파기·로그/백업 정책과 시행일을 확정한다. 확정 정책은 새 버전으로 발행하고 실제 필수 동의·재동의, 탈퇴 시 개인정보 파기와 필요한 거래 이력 보존을 검증한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

## Trading 가용성 및 장애 대응

- [ ] OPS-13 — Redis·Trading Worker·Binance 상태 모니터링
  - Redis 연결/구독, Stream 크기·체크포인트 지연, gap_count, producer gapSequence, Worker 재시도·오류 cursor와 Binance 연결·재연결·시계 오차·종목별 Mark freshness를 관측한다. READY와 개별 주문 시세 처리 완료 여부를 구분한다. 단일 Worker 전제를 확인하고 소유권 설계 없이 Trading 인스턴스를 복제하지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-14 — ENGINE_RECOVERING·시세 단절·Worker 재처리 복구
  - 오류 시각·배포 버전과 상태를 함께 수집하여 정상 처리 대기, DB 계정/commit 잠금, Redis/Stream 단절, Binance 시세 장애, 반복 실패하는 Worker를 구분한다. 주문/취소/체결·청산의 멱등성과 원자성을 유지한 채 실제 복구 후 거래 재개를 확인한다. 안전 게이트 제거·오래된 가격 체결·무조건적인 타임아웃 증가로 해결하지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-15 — Guest 계정 생성 API Rate Limit과 자원 보호
  - /api/v1/trading/accounts/guest에 대해 신뢰 프록시의 실제 IP 판별, 허용량·burst·429 응답·관측/차단 해제 기준을 정하고 부하를 검증한다. 사용자가 전달한 임의 IP 헤더를 신뢰하지 않는다. 회원/Guest 소유권 분리와 기존 이력 보존·미사용 Guest 정리 규칙을 유지한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

- [ ] OPS-16 — 운영 부하 테스트·로그·장애 알림
  - 격리 환경에서 주문/취소/체결·부분 청산·강제청산·회차 재시작 경합, DB 잠금·연결 풀, WebSocket 느린 소비자, Redis 장애와 정상 복구를 측정한다. DB 원장 불변조건과 복구 후 중복 반영 여부를 확인하고 지연/오류·디스크·백업 실패 경보 및 담당자/대응 절차를 정한다. 개인정보·Token을 제외한 로그의 보관·접근·용량 정책을 확정한다.
  - 완료일: — / 관련 PR: — / 검증 결과: —

## 의존성 보안

- [ ] OPS-17 — Spring Boot·Next.js 및 전이 의존성 보안 관리
  - 배포 시점 공식 보안 공지·지원 상태와 Gradle/npm lockfile의 실제 버전을 점검하고 취약점 우선순위·업데이트 주기를 정한다. 서비스별 테스트/빌드와 인증·거래 회귀를 통과시킨다. Java 17/Spring Boot 3.5.x 등 기반 기술 변경은 별도 승인을 받고, 버전만 올린 것을 운영 검증 완료로 간주하지 않는다.
  - 완료일: — / 관련 PR: — / 검증 결과: —
