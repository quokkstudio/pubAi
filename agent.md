너는 Electron + Node.js + Playwright 기반의 데스크톱 DevManager 프로그램을 설계하고 구현하는 시니어 아키텍트다.

목표:
쇼핑몰 솔루션(Cafe24, Godomall, MakeShop 등)을 통합 관리하는 DevManager GUI 데스크톱 앱을 만든다.

이 프로그램은 나만 사용하는 내부 Dev 도구다.
상용 서비스 수준 보안은 필요 없지만, 구조는 확장 가능하고 유지보수 가능하게 설계한다.

-------------------------------------------------
[기술 스택]
- Electron
- React + TypeScript (renderer)
- Node.js (main process)
- Playwright
- basic-ftp (FTP 처리)
- child_process (Codex CLI, WinSCP 실행용)
- 파일 기반 프로젝트 저장 (DB 사용하지 않음)

-------------------------------------------------
[핵심 기능 요구사항]

1. 프로젝트 관리

1-1. 프로젝트 생성
- 프로젝트명 입력
- 솔루션 타입 선택 (Cafe24 / Godomall / MakeShop)
- 관리자 정보 입력 (URL, ID, PW)
- FTP 정보 입력 (host, user, pass)
- MakeShop의 경우 skin_id 입력
- 완료 예정일 입력

생성 시:
- projects/{projectName}/ 폴더 생성
- config.json 생성
- project-info.md 생성
- workflow.md 생성
- local/ 폴더 생성
- logs/ 폴더 생성

1-2. 프로젝트 리스트 화면
- 프로젝트명
- 타입
- 최근 작업 일시
- 완료 예정일
- 실행 버튼
- 배포 버튼
- 최초 동기화 버튼

2. 프로젝트 상세 화면

- 좌측: local 폴더 트리 구조 표시
- 우측:
  - project-info.md 편집 가능
  - workflow.md 편집 가능
  - 로그 출력 영역
- 하단 버튼:
  - VSCode 열기
  - 최초 동기화
  - 배포
  - 관리자 확인 (Playwright)

3. 실행 버튼 동작

- VSCode로 해당 프로젝트 local 폴더 열기
- WinSCP 세션 실행 (연결만, 자동 동기화 X)
- Codex CLI 준비 (단순 실행 가능 상태)

4. 최초 1회 동기화

- Cafe24 / Godomall:
  - FTP로 서버 전체 스킨을 local 폴더로 다운로드
- MakeShop:
  - (초기 버전에서는 수동으로 local에 복사한다고 가정)

5. 배포 로직

DeployRouter를 만들어 솔루션별 분기:

if (type === "cafe24" || type === "godomall"):
    - 변경된 파일 감지 (local 기준, 이전 배포 기록과 비교)
    - WinSCP CLI 또는 basic-ftp로 변경 파일만 업로드

if (type === "makeshop"):
    - local 전체를 tar로 압축
    - Playwright로 관리자 로그인
    - skin_id에 업로드
    - 완료 감지

6. 관리자 확인 버튼

Playwright로:
- 관리자 로그인
- 해당 스킨/파일 열기
- 완료 후 브라우저 유지

-------------------------------------------------
[파일 구조]

DevManager/
  electron/
    main.ts
    preload.ts
    renderer/
      App.tsx
      pages/
        Dashboard.tsx
        ProjectCreate.tsx
        ProjectDetail.tsx
  core/
    projectManager.ts
    codexEngine.ts
    deployRouter.ts
    ftpEngine.ts
    cafe24Engine.ts
    godomallEngine.ts
    makeshopEngine.ts
    logger.ts
  projects/

-------------------------------------------------
[설계 요구사항]

1. main process와 renderer는 IPC로 통신한다.
2. 비밀번호는 config.json에 저장하되 추후 암호화 확장 가능하도록 구조 설계.
3. 모든 작업은 logger를 통해 logs/{date}.log에 기록.
4. 변경 파일 감지는:
   - 파일 수정 시간 기반으로 구현 (초기 버전)
5. 코드 작성 시:
   - 각 기능은 함수로 분리
   - 솔루션 엔진은 인터페이스 기반으로 설계
6. 전체 코드를 단계별로 생성한다:
   STEP 1: Electron 기본 구조 생성
   STEP 2: 프로젝트 CRUD 기능
   STEP 3: FTP 동기화 기능
   STEP 4: MakeShop Playwright 업로드 엔진
   STEP 5: DeployRouter 연결
   STEP 6: UI 완성
   STEP 7: 테스트 및 정리

-------------------------------------------------
[UI 요구사항]

- 좌측 사이드바: 프로젝트 리스트
- 우측 메인 패널: 상세 화면
- 상단바: 새 프로젝트 버튼
- 하단: 실시간 로그 콘솔 영역
- 디자인은 심플한 다크 테마

-------------------------------------------------
[중요]

- 처음부터 완벽하게 하지 않는다.
- 동작 우선.
- 모듈 분리.
- 확장 가능하게 작성.
- 실행 가능한 코드부터 단계적으로 생성.

지금부터 STEP 1부터 순서대로 구현을 시작하라.
먼저 프로젝트 초기화 및 Electron 기본 구조를 생성하는 코드와 설치 명령어를 작성하라.
작업 후, 제대로 되었는지 확인 해보고, 오류가 있거나 문제가있으면 답변 남기고, 바로 다시 수정진행을 반복하여 문제 없을 때 결과 를 알려준다.( 스텝단위로 )

-------------------------------------------------
[작업 진행 현황 - 2026-02-26]

- STEP 1 완료
  - Electron + React + TypeScript 기본 구조 구성
  - dev/start 실행 경로 정리 및 실행 안정화

- STEP 2 완료
  - 프로젝트 생성/목록/상세 조회/문서 저장 CRUD 구현
  - projects/{projectKey} 파일 기반 저장 구조 동작 확인

- STEP 3 완료
  - Cafe24/Godomall FTP 최초 동기화 구현 (basic-ftp)
  - MakeShop 최초 동기화는 수동 local 복사 안내 방식 구현
  - FTP 타임아웃/재시도/IPv4 passive 대응
  - 550 Permission denied 항목 건너뛰기 처리

- 실행/운영 보강 완료
  - run-devmanager.cmd, run-devmanager-debug.cmd 추가
  - 검은 화면 이슈 수정 (build asset 상대 경로)
  - 실행 버튼: local 폴더 VSCode 열기 경로 보강

-------------------------------------------------
[다음 작업 계획]

- STEP 4: MakeShop Playwright 업로드 엔진 구현
  - 로그인 -> skin_id 업로드 -> 완료 감지

- STEP 5: DeployRouter 고도화
  - Cafe24/Godomall 변경 파일 감지 후 변경분 배포
  - MakeShop 압축/업로드 플로우 연결

- STEP 6: UI 완성
  - 로그/상태 표시 개선
  - 상세 화면 작업 버튼 및 피드백 고도화

- STEP 7: 테스트 및 정리
  - 시나리오 테스트
  - 예외 처리/문서 정리

-------------------------------------------------
[추가 요청 - 2026-02-26]

- 메인 앱 좌측 패널(프로젝트목록/새프로젝트/프로젝트상세) 접기/펼치기 지원
- 좌측 패널 접힘 상태에서 우측 영역 반응형 확장
- 프로젝트 목록에서 프로젝트명 클릭 시 실행 동작
- 실행 버튼은 새 워크스페이스 창 오픈 방식으로 동작
- 새 창 UI:
  - 좌측: 폴더 트리(폴더 확장/파일 선택)
  - 가운데: 파일 내용 열람/편집/저장
  - 우측: Codex 채팅 패널(설정/모델/권한/이성수준/첨부/사용량 표시)
  - 패널 드래그 리사이즈 지원
- Codex는 프로젝트 작업 폴더 기준으로 동작해야 함

-------------------------------------------------
[추가 요청 - 2026-02-27]

- 이미지/첨부 경로 클릭 시 파일 열기 동작 필요
- Codex 설정 메뉴에 계정/로그인/로그아웃/config.toml/MCP 설정 항목 추가
- Codex 로그인 후 로그아웃 전까지 로그인 상태 유지
- MCP 프리셋 토글: Playwright, Chrome DevTools

-------------------------------------------------
[추가 요청 - 2026-02-27]

- codex 실행파일 경로 수동 설정 UI 필요(ENOENT 대응)
- 로그인은 앱 내에서 처리하고, 로그아웃 전까지 유지

-------------------------------------------------
[추가 요청 - 2026-02-27]

- API Key 로그인 제거
- ChatGPT 플랜 로그인 방식(device auth)만 사용

-------------------------------------------------
[추가 요청 - 2026-02-27]

- ChatGPT 로그인 버튼 클릭 시 UI 멈춤처럼 보이지 않게 비동기 시작 방식으로 변경
- 로그인 상태 수동 새로고침 버튼 제공
 
