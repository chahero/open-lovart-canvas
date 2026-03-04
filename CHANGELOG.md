# 변경 이력 (Changelog)

[English version](./CHANGELOG.EN.md)

이 문서는 프로젝트의 주요 변경 사항을 시간순으로 기록합니다.

문서 운영 원칙:
- `README.md` / `README.EN.md`: 현재 기능 상태와 실행 방법
- `CHANGELOG.md` / `CHANGELOG.EN.md`: 개발 버전 및 변경 이력

## [Unreleased]

### Added
- 비디오 레이어(썸네일 기반) 캔버스 추가 지원
- Library의 이미지/비디오 자산 통합 저장 및 표시 지원
- Library 비디오 카드의 플레이 버튼을 통한 모달 재생
- AI 프롬프트 히스토리(모드별 자동 저장/재사용/삭제)
- `.lvcproj` 기반 프로젝트 저장/불러오기 상태 복원 강화

### Changed
- AI 모드(`t2i`, `i2i_single`, `i2i_multi`, `upscale`) 분리 및 워크플로우 매핑 동작 개선
- Library 저장 액션 명칭을 `Save Selected Asset`으로 변경

### Fixed
- 단일 소스 이미지만 제공되는 경우에도 다중 `LoadImage` 노드를 가진 워크플로우를 I2I Single에서 처리 가능하도록 매핑 보완
- Library 비디오 플레이 오버레이의 접근성 경고(`aria-hidden` 포커스 충돌) 해소

## [2026-03 초기 알파 안정화]

### Scope
- 에디터 안정성 및 UX 일관성 보강
- ComfyUI/Ollama 연계 미디어 워크플로우 동작 정리
- README/CHANGELOG 문서 체계 정비
