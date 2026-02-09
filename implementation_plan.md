# Open Lovart Canvas: Implementation Plan

## 1. Overview
Building an AI-powered image editor requires a bridge between a high-performance Canvas UI (Frontend) and heavy-duty AI models (Inference). 

### Chosen Architecture:
- **Frontend**: React + Fabric.js (Canvas) + Lucide (Icons)
- **Backend**: FastAPI (Python) - *Recommended for seamless integration with AI libraries (PyTorch, OpenCV)*.
- **AI Inference**: Hybrid approach (Replicate for speed/testing, Local for privacy/cost).

---

## 2. Core AI Features & Technical Mapping

| Feature | Primary AI Model / API | Implementation Strategy |
| :--- | :--- | :--- |
| **Object Segmentation** | **SAM (Segment Anything Model)** | User clicks point -> Send to SAM -> Get polygon mask -> Create separate layer. |
| **Background Removal** | **RMBG-1.4** or **Replicate (rembg)** | Send image -> Get PNG Alpha mask -> Update canvas layer. |
| **Text Detection (OCR)** | **PaddleOCR** or **EasyOCR** | Scan image -> Get bounding boxes & text strings. |
| **Text Inpainting** | **Stable Diffusion Inpainting** or **LaMa** | Mask out old text -> Inpaint background -> Overlay editable text object. |
| **Image Upscaling** | **Real-ESRGAN** or **Magnific (API)** | Process selected layer -> Replace with high-res texture. |

---

## 3. Implementation Roadmap

### Phase 1: Infrastructure & API Proxy (Immediate)
- Setup a Python-based backend (FastAPI).
- Integrate **Replicate SDK** for fast prototyping of SAM and Inpainting.
- Implement file handling (S3/Local storage) for processing high-res images.

### Phase 2: Segmentation Workflow (The "Edit Elements" feature)
- Implement a "point-and-segment" mode on the canvas.
- Connect to Meta's SAM (Segment Anything Model) via Replicate.
- Extract masking data and use OpenCV (backend) to cut out the object from original image.
- Send back the "Cut-out PNG" as a new Fabric.js layer.

### Phase 3: Text Awareness (OCR Layer)
- OCR detection to find all text in an image.
- Automatically create Fabric.IText objects on top of the original text.
- Use Inpainting to remove the *original* pixels under the text so the background looks clean.

### Phase 4: Local Model Migration (Optional/Advanced)
- If the user prefers local execution: Setup **ComfyUI** or **Diffusers** as a local host.
- Use WebSockets to stream results to the React frontend.

---

## 4. Replicate vs Local AI

### Replicate (Pros/Cons)
- ✅ **Pros**: Zero setup, high-end GPUs, Pay-as-you-go, scalable.
- ❌ **Cons**: Costly for frequent users, slight latency.

### Local AI (Pros/Cons)
- ✅ **Pros**: Free (if hardware exists), Private, Low latency.
- ❌ **Cons**: Requires NVIDIA GPU (8GB+ VRAM), complex environment setup (CUDA, Python).

---

## 5. Next Steps
1. **Initialize Backend**: Create a `server/` directory with FastAPI.
2. **API Key Setup**: Obtain a Replicate API Key.
3. **Endpoint Integration**: Create a bridge between `App.jsx` and the backend for the "Remove BG" feature first.
