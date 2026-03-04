# Changelog

[한국어 버전](./CHANGELOG.md)

This document tracks notable project changes in chronological order.

Documentation policy:
- `README.md` / `README.EN.md`: current product state and setup
- `CHANGELOG.md` / `CHANGELOG.EN.md`: development versions and history

## [Unreleased]

### Added
- Video layer support on canvas (thumbnail-based rendering)
- Unified Library support for mixed media assets (image + video)
- Library video-card play button with modal playback
- AI prompt history (per-mode auto-save, reuse, delete)
- Improved `.lvcproj` project save/load state restoration

### Changed
- Refined AI mode split and workflow mapping behavior for `t2i`, `i2i_single`, `i2i_multi`, `upscale`
- Renamed Library save action to `Save Selected Asset`

### Fixed
- Improved I2I Single mapping for workflows that contain multiple `LoadImage` nodes when only one source image is provided
- Resolved accessibility warning in Library video play overlay (`aria-hidden` focus conflict)

## [2026-03 Initial Alpha Stabilization]

### Scope
- Editor stability and UX consistency pass
- Media workflow integration cleanup for ComfyUI/Ollama paths
- README/CHANGELOG documentation structure alignment
