# Open Lovart Canvas (Alpha)

[**English version**](./README.EN.md)

Open Lovart Canvas는 Fabric.js 기반의 웹 캔버스 편집기입니다.
이미지를 그리는/편집하는 작업 흐름에 AI 파이프라인을 결합해,
빠르게 시안·수정·재생성을 반복할 수 있도록 설계한 프로젝트입니다.

## 핵심 기능

- **캔버스 편집기**
  - 도형/이미지/텍스트 레이어를 생성하고 배치
  - 이동, 크기 조절, 회전, 스냅, 그룹/해제, 정렬
- **Touch Edit (Mark Mode)**
  - `M` 토글, 브러시/펜 기반 편집 흐름 지원
- **컨텍스트 기반 레이어 액션**
  - 레이어 우클릭 메뉴(앞/뒤로 보내기, 순서 이동, 그룹/해제, 배경 제거 등)
- **레이어 이름 관리**
  - 라이브러리/레이어 이름 편집
- **AI 기능 통합**
  - FastAPI 백엔드 기반 ComfyUI/Ollama 연동
  - T2I / I2I / I2I Multi 버튼 분리
  - 워크플로우별 프롬프트/이미지 입력 매핑 설정
- **AI 작업 메뉴**
  - Object Split(SAM), Background Removal, Smart OCR Edit, Image Upscale
- **프로젝트 저장/복원**
  - `.lvcproj` 포맷으로 작업 상태 저장
  - 캔버스 배경/격자/줌/스냅/설정까지 함께 복원
- **Export & 설정**
  - 해상도/포맷을 지정해 이미지 저장
  - Settings에서 ComfyUI/Ollama 구성 일괄 관리

## 기술 스택

- Frontend: React + Vite
- Canvas Engine: Fabric.js
- Backend: FastAPI
- Language: JavaScript / Python

## 실행 방법

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
cd server
python -m venv .venv
# Windows
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

`server/.env` 예시:

```env
OLLAMA_URL=http://192.168.0.67:11434
COMFYUI_URL=http://192.168.0.67:8188
SAM3_MODEL_PATH=models/sam3.pt
SERVER_HOST=0.0.0.0
SERVER_PORT=8002
FRONTEND_URL=http://localhost:5173
```

## SAM3 모델(`sam3.pt`) 준비

세그멘테이션 기능(`/segment`)을 사용하려면 SAM3 가중치 파일이 필요합니다.

1. 먼저 Hugging Face에서 SAM3 접근 승인을 받습니다.
   - https://huggingface.co/facebook/sam3
2. `server/models` 폴더를 생성합니다.
3. 사용 중인 Ultralytics SAM3 체크포인트 파일을 다운로드합니다.
4. 파일명을 `sam3.pt`로 맞춰 `server/models/sam3.pt`에 배치합니다.
4. `server/.env`에 경로를 지정합니다.

```env
SAM3_MODEL_PATH=models/sam3.pt
```

참고:
- 코드 기본 경로는 `models/sam3.pt`이며, 없으면 `server/sam3.pt`도 레거시 경로로 확인합니다.
- 서버 시작 시 모델 초기화 실패 로그가 나오면 경로/파일명을 먼저 확인하세요.

## 프로젝트 상태

- 현재 기능은 계속 개선 중입니다.
- 주요 흐름: 캔버스 편집 안정성, AI 워크플로우 매핑/호환성, 저장 포맷 정합성
- 버그/개선 건의는 이슈로 남겨 주시면 우선순위 반영합니다.

## 라이선스

라이선스 정책은 추후 확정 예정입니다.

## 최근 업데이트 (2026-03)

- 비디오를 캔버스 레이어로 추가 가능 (썸네일 기반).
- Library에서 이미지/비디오를 구분 표시하고, 선택 자산 저장(`Save Selected Asset`) 지원.
- Library 비디오 카드의 플레이 버튼으로 모달 재생 지원.
- AI 모드(T2I / I2I Single / I2I Multi / Upscale) 분리 및 워크플로우 매핑 개선.
- 프롬프트 히스토리(모드별 자동 저장/재사용/삭제) 추가.
- 프로젝트 저장/불러오기(`.lvcproj`) 및 설정/캔버스 상태 복원 강화.

## 버전 히스토리

- 개발 버전/변경 이력은 루트 `CHANGELOG.md` / `CHANGELOG.EN.md`에서 관리합니다.
