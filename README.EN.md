# Open Lovart Canvas (Alpha)

[**한국어 버전**](./README.md)

Open Lovart Canvas is a Fabric.js-based web canvas editor.
It combines manual image editing with AI-powered workflows so you can run
prompt-based, image-based, and mixed generation/editing loops in one place.

## Key Features

- **Canvas Editing**
  - Create and manage shape/image/text layers
  - Move, resize, rotate, snap, group/ungroup, and reorder layers
- **Touch Edit (Mark Mode)**
  - Toggle with `M`
  - Brush/touch-style interaction flow for marking and editing
- **Layer Context Actions**
  - Right-click menu for bring/ send to back, move order, grouping, background removal, etc.
- **Layer Naming**
  - Rename library and canvas layer items
- **AI Integration**
  - FastAPI backend with ComfyUI and Ollama
  - Separate action buttons for T2I, I2I, and I2I Multi
  - Workflow-based prompt/image input mapping in Settings
- **AI Operations**
  - Object Split (SAM), Background Removal, Smart OCR Edit, Image Upscale
- **Project Save/Load**
  - Save and restore work state with `.lvcproj`
  - Includes canvas metadata such as background, grid, zoom, and tool settings
- **Export and Settings**
  - Export image with selectable format/size
  - Centralized workflow and backend connection settings

## Tech Stack

- Frontend: React + Vite
- Canvas Engine: Fabric.js
- Backend: FastAPI
- Languages: JavaScript / Python

## Getting Started

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

Example `server/.env`:

```env
OLLAMA_URL=http://192.168.0.67:11434
COMFYUI_URL=http://192.168.0.67:8188
SAM3_MODEL_PATH=models/sam3.pt
SERVER_HOST=0.0.0.0
SERVER_PORT=8002
FRONTEND_URL=http://localhost:5173
```

## Preparing SAM3 model (`sam3.pt`)

The segmentation endpoint (`/segment`) requires a SAM3 checkpoint file.

1. Request access to SAM3 on Hugging Face first.
   - https://huggingface.co/facebook/sam3
2. Create the `server/models` directory.
3. Download the SAM3 checkpoint you use with Ultralytics.
4. Rename/place it as `server/models/sam3.pt`.
5. Set the path in `server/.env`.

```env
SAM3_MODEL_PATH=models/sam3.pt
```

Notes:
- The default path in code is `models/sam3.pt`.
- If not found, the backend also checks a legacy path at `server/sam3.pt`.
- If model initialization fails at startup, verify filename and path first.

## Project Status

- The project is actively evolving.
- Current focus: editor stability, workflow compatibility, and project file format reliability.
- Bugs and enhancement suggestions are welcome.

## License

License policy will be added.

## Recent Updates (2026-03)

- Added video layer support on canvas (thumbnail-based).
- Library now distinguishes image/video assets and supports `Save Selected Asset`.
- Added modal playback from the video play button in Library cards.
- Separated AI modes (T2I / I2I Single / I2I Multi / Upscale) with improved workflow mapping behavior.
- Added prompt history (per-mode auto-save, reuse, and delete).
- Improved `.lvcproj` project save/load with stronger state restore.

## Version History

- Development versions and detailed change records are tracked in root `CHANGELOG.EN.md` / `CHANGELOG.md`.
