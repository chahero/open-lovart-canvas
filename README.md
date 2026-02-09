# Open Lovart Canvas (Alpha)

AI 기반 이미지 편집 툴 Lovart의 핵심 기능을 오픈소스 기술로 재현하는 프로젝트입니다. 레이어 기반의 직관적인 디자인 시스템과 향후 AI 모델 연동을 위한 Mark Mode(Touch Edit) 인터페이스를 제공합니다.

## ✨ 주요 기능

- **레이어 기반 편집**: 이미지, 텍스트, 도형을 각각의 레이어로 자유롭게 배치하고 수정할 수 있습니다.
- **Mark Mode (Touch Edit)**: Lovart의 핵심 UX인 '터치 편집'을 재현했습니다. 클릭만으로 객체 좌표를 마킹하고 AI 처리를 준비합니다.
- **Drag & Drop 업로드**: 탐색기에서 이미지를 캔버스로 직접 끌어다 놓아 즉시 추가할 수 있습니다.
- **프리미엄 UI/UX**: 다크 모드 기반의 세련된 디자인과 둥근 컨트롤러, 글래스모피즘이 적용된 플로팅 바를 제공합니다.
- **단축키 및 편의 기능**:
  - `M`: Mark Mode 전환
  - `V`: 선택 도구 전환
  - `Delete / Backspace`: 객체 삭제
  - `Ctrl + C / V`: 객체 복사 및 붙여넣기
  - 우클릭 컨텍스트 메뉴 제공

## 🛠 기술 스택

- **Frontend**: React (Vite)
- **Canvas Engine**: Fabric.js
- **Icons**: Lucide-React
- **Styling**: Vanilla CSS (Custom Properties)

## 🚀 시작하기

### 설치
```bash
npm install
```

### 실행
```bash
npm run dev
```

## 🗺 로드맵 (AI 연동 계획)

향후 다음과 같은 AI 기능을 백엔드(FastAPI)와 연동하여 구현할 예정입니다.

1. **Object Split (SAM)**: 마킹된 좌표를 바탕으로 배경에서 객체를 자동으로 분리하여 개별 레이어화
2. **AI Background Removal**: 원클릭 배경 제거 기능
3. **Smart OCR Edit**: 이미지 내 텍스트를 인식하여 배경은 채우고(Inpainting), 글자만 수정 가능하게 변경
4. **Image Upscale**: 저해상도 이미지의 품질 개선

## 📄 라이선스

이 프로젝트는 학습 및 연구 목적으로 제작되었습니다.
