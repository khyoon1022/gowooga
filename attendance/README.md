# 출퇴근 기록 시스템

직원이 휴대폰으로 출근/퇴근을 누르고 본인 기록을 조회, 관리자는 매장별 현황을 확인합니다.

| 화면 | 주소 (도메인 연결 후) |
|---|---|
| 직원용 | `https://gowoofnb.com/attendance/` |
| 관리자용 | `https://gowoofnb.com/attendance/admin.html` |

## 구조

```
휴대폰 브라우저 ──► attendance/*.html (GitHub Pages, gowoofnb.com)
                        │  fetch
                        ▼
               Google Apps Script 웹 앱 (서버)
                        │
                        ▼
               Google 스프레드시트 (직원 / 기록 / 설정 시트)
```

- 도메인은 "접속 주소"일 뿐 데이터 저장 기능이 없으므로, 저장은 구글 시트가 담당합니다.
- 출퇴근 시각은 **구글 서버 시각**으로 기록 (휴대폰 시계 조작 무효).
- 자정을 넘긴 근무: 출근 후 20시간 이내 퇴근은 같은 근무로 처리, 근무일은 출근일 기준.

## 설치 (최초 1회, 약 10분)

1. 구글 드라이브에서 새 스프레드시트 생성 → 이름: `출퇴근기록`
2. 메뉴 **확장 프로그램 → Apps Script**
3. `Code.gs` 내용을 전부 지우고 `apps-script/Code.gs` 붙여넣기
4. 톱니바퀴(프로젝트 설정) → **"appsscript.json" 매니페스트 파일 표시** 체크 → `apps-script/appsscript.json` 내용으로 교체
5. 상단 함수 선택에서 `setup` 선택 → **실행** → 권한 승인 → 시트 3개 생성 확인
6. **설정** 시트 B2의 `change-me`를 관리자 비밀번호로 변경
7. **직원** 시트에 명단 입력

   | 사번 | 이름 | 매장 | PIN | 사용여부 |
   |---|---|---|---|---|
   | 0101 | 홍길동 | 고우가 여의도 | 4821 | Y |

   - 퇴사자는 행 삭제 대신 사용여부 `N` (기존 기록 보존)
8. **배포 → 새 배포 → 유형: 웹 앱** → 실행 사용자: 나 / 액세스: 모든 사용자 → 배포 → **웹 앱 URL 복사**
9. `attendance/config.js`의 `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`를 복사한 URL로 교체 후 커밋

> `Code.gs`를 수정한 경우 **배포 관리 → 편집 → 새 버전**으로 다시 배포해야 반영됩니다.

## gowoofnb.com 연결

현재 레포에 `CNAME` 파일이 없어, gowoofnb.com이 이 GitHub Pages에 연결되어 있는지 확인이 필요합니다.

1. GitHub 레포 **Settings → Pages → Custom domain**에 `gowoofnb.com` 입력
2. 도메인 구입처(가비아 등) DNS에 GitHub Pages 레코드 등록
   - 안내: https://docs.github.com/ko/pages/configuring-a-custom-domain-for-your-github-pages-site

## 운영

- 월별 근무시간 집계: **기록** 시트를 엑셀로 내려받아 피벗 (사번·근무일 기준, `근무시간(분)` 합계)
- 퇴근 누락 시: 기록 시트의 `퇴근시각`·`근무시간(분)`을 관리자가 직접 입력
- PIN 5회 오류 시 해당 사번 10분 잠금

## 한계 (현재 버전)

- 위치 인증 없음 → 대리 출근 방지 불가
- PIN은 시트에 평문 저장 → 시트 공유 범위를 관리자로 제한할 것
- 구글 시트 기반이므로 기록이 수만 건 이상 쌓이면 느려질 수 있음 → 연 단위로 기록 시트 분리 권장
