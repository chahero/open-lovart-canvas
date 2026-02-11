import os
import io
import uuid
import json
import httpx
import base64
import time
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image
from dotenv import load_dotenv
from rembg import remove, new_session
from ultralytics import SAM
from ultralytics.models.sam import SAM3SemanticPredictor
import numpy as np
import torch
import re
from scipy.ndimage import zoom

# Load configurations
load_dotenv()
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://192.168.0.67:11434")
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://localhost:8188")

# Initialize rembg session for persistent model loading
try:
    rembg_session = new_session()
except Exception:
    rembg_session = None

# Initialize SAM 3 models
try:
    # 1. Standard SAM model for single object (points/boxes)
    sam3_model = SAM("sam3.pt")
    
    # 2. Semantic Predictor for concept segmentation (text)
    overrides = dict(conf=0.25, task="segment", mode="predict", model="sam3.pt", save=False)
    sam3_predictor = SAM3SemanticPredictor(overrides=overrides)
except Exception as e:
    print(f"SAM 3 models initialization failed: {e}")
    sam3_model = None
    sam3_predictor = None

app = FastAPI(title="Open Lovart AI Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def call_comfyui_workflow(workflow: dict):
    """
    Helper to send a workflow to ComfyUI and wait for results (simplified)
    """
    client_id = str(uuid.uuid4())
    async with httpx.AsyncClient() as client:
        # 1. Queue Prompt
        prompt_res = await client.post(
            f"{COMFYUI_URL}/prompt", 
            json={"prompt": workflow, "client_id": client_id}
        )
        prompt_id = prompt_res.json().get("prompt_id")
        
        # 2. Wait for completion (Polling - in a real app, use WebSockets)
        while True:
            history_res = await client.get(f"{COMFYUI_URL}/history/{prompt_id}")
            history = history_res.json()
            if prompt_id in history:
                # Get the image filename from history
                outputs = history[prompt_id].get("outputs", {})
                for node_id in outputs:
                    if "images" in outputs[node_id]:
                        filename = outputs[node_id]["images"][0]["filename"]
                        # 3. Fetch final image
                        img_res = await client.get(f"{COMFYUI_URL}/view?filename={filename}")
                        return img_res.content
            time.sleep(0.5)

@app.get("/")
async def root():
    return {
        "status": "online",
        "config": {
            "ollama": OLLAMA_URL,
            "comfyui": COMFYUI_URL
        }
    }

@app.put("/config/update")
async def update_config(data: dict):
    global OLLAMA_URL, COMFYUI_URL
    if "ollama" in data: OLLAMA_URL = data["ollama"]
    if "comfyui" in data: COMFYUI_URL = data["comfyui"]
    return {"status": "success", "new_config": {"ollama": OLLAMA_URL, "comfyui": COMFYUI_URL}}

@app.post("/remove-bg")
async def remove_background(file: UploadFile = File(...)):
    """
    Remove Background using local rembg (pip package)
    """
    try:
        input_data = await file.read()
        
        # Use existing session if available for speed
        if rembg_session:
            output_data = remove(input_data, session=rembg_session)
        else:
            output_data = remove(input_data)
            
        return StreamingResponse(io.BytesIO(output_data), media_type="image/png")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Background removal failed: {str(e)}")

@app.post("/segment")
async def segment_object(
    file: UploadFile = File(...),
    points: str = Form("[]"), 
    labels: str = Form("[]"),
    bboxes: str = Form("[]"), 
    text: str = Form(None)
):
    """
    Segment Object using SAM 3
    - Uses SAM3SemanticPredictor if text is provided (Concept mode)
    - Uses SAM.predict if only points/boxes are provided (Single Object mode)
    """
    if not sam3_model or not sam3_predictor:
        raise HTTPException(status_code=500, detail="SAM 3 models not initialized.")

    try:
        # Load image
        img_data = await file.read()
        image = Image.open(io.BytesIO(img_data)).convert("RGB")
        img_np = np.array(image)
        h, w = img_np.shape[:2]

        pts = json.loads(points) if points else []
        lbls = json.loads(labels) if labels else [1] * len(pts)
        boxes = json.loads(bboxes) if bboxes else []

        print(f"--- SAM 3 Request ---")
        print(f"Input: Text='{text}', Points={len(pts)}, Boxes={len(boxes)}")

        # Decision Logic
        if text:
            # Concept Segmentation Mode
            print("Mode: Concept Segmentation (SAM3SemanticPredictor)")
            sam3_predictor.set_image(img_np)
            query_args = {"text": [text]}
            if pts: query_args["points"] = pts; query_args["labels"] = lbls
            if boxes: query_args["bboxes"] = boxes
            results = sam3_predictor(**query_args)
        else:
            # Single Object Mode (SAM 2 Compatibility)
            print("Mode: Single Object Segmentation (SAM.predict)")
            predict_args = {
                "source": img_np,
                "device": "cuda" if torch.cuda.is_available() else "cpu",
                "conf": 0.25
            }
            if boxes:
                # SAM.predict expects bboxes=[x1, y1, x2, y2] or list of lists
                predict_args["bboxes"] = boxes[0] if len(boxes) == 1 else boxes
            if pts:
                predict_args["points"] = pts
                predict_args["labels"] = lbls
            
            results = sam3_model.predict(**predict_args)
        
        if not results or len(results) == 0:
            raise HTTPException(status_code=500, detail="No evaluation results from SAM 3.")
        
        if not hasattr(results[0], 'masks') or results[0].masks is None or len(results[0].masks.data) == 0:
             raise HTTPException(status_code=400, detail="AI could not identify any object. Please try different prompts.")

        # Get the best mask
        mask = results[0].masks.data[0].cpu().numpy()
        
        # Resize mask to original image size
        mh, mw = mask.shape
        if (h, w) != (mh, mw):
            mask = zoom(mask, (h / mh, w / mw), order=1)

        # Create transparent segment
        output_img = np.zeros((h, w, 4), dtype=np.uint8)
        output_img[:, :, :3] = img_np
        output_img[:, :, 3] = (mask > 0.5).astype(np.uint8) * 255
        
        res_image = Image.fromarray(output_img)
        buf = io.BytesIO()
        res_image.save(buf, format="PNG")
        return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="image/png")

    except HTTPException:
        # Re-raise HTTP exceptions to let FastAPI handle them (e.g. 400 No object detected)
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")

@app.post("/extract-text")
async def extract_text(file: UploadFile = File(...)):
    """
    Extract text content using DeepSeek-OCR (optimized for high accuracy).
    """
    try:
        # Load and preprocess image
        img_data = await file.read()
        image = Image.open(io.BytesIO(img_data))
        
        # Ensure RGB mode
        if image.mode == 'RGBA':
            background = Image.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])
            image = background
        else:
            image = image.convert("RGB")
            
        # Optimization for OCR
        max_size = 1024
        if max(image.size) > max_size:
            ratio = max_size / max(image.size)
            new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
            image = image.resize(new_size, Image.Resampling.LANCZOS)
            
        # Re-encode to Base64
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        img_b64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        # Using DeepSeek-OCR official recommended prompt
        payload = {
            "model": "deepseek-ocr:3b",
            "prompt": "Extract the text in the image.",
            "images": [img_b64],
            "stream": False,
            "options": {
                "temperature": 0.1
            }
        }
        
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{OLLAMA_URL}/api/generate", 
                json=payload, 
                timeout=300.0
            )
            
            if res.status_code == 200:
                result = res.json()
                raw_response = result.get('response', '').strip()
                print(f"DeepSeek-OCR Raw Response: [{raw_response}]")
                
                # --- Cleaning logic ---
                # 1. Remove markdown code blocks if present
                clean_response = re.sub(r'```.*?```', '', raw_response, flags=re.DOTALL)
                if not clean_response.strip(): clean_response = raw_response
                
                # 2. Split into lines and deduplicate while preserving order
                lines = [line.strip() for line in clean_response.split('\n') if line.strip()]
                unique_lines = []
                for line in lines:
                    if line not in unique_lines:
                        unique_lines.append(line)
                
                # 3. Join back together
                final_text = " ".join(unique_lines)
                
                print(f"DeepSeek-OCR Cleaned Result: {final_text}")
                return {
                    "content": final_text,
                    "color": "#000000",
                    "isBold": False
                }
            else:
                print(f"Ollama API Error: {res.status_code} - {res.text}")
                return {"content": "DeepSeek-OCR failed to load. Resource issue?", "color": "#000000", "isBold": False}
                
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"DeepSeek-OCR Error: {e}")
        return {"content": f"Connection error: {str(e)}", "color": "#000000", "isBold": False}

@app.post("/analyze-vision")
async def analyze_vision(file: UploadFile = File(...), prompt: str = Form(...)):
    """
    Analyze image with Ollama Vision
    """
    img_data = await file.read()
    img_b64 = base64.b64encode(img_data).decode('utf-8')
    
    payload = {
        "model": "llama3.2-vision",
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [img_b64]
            }
        ],
        "stream": False
    }
    
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=60.0)
        return res.json()

@app.post("/generate-image")
async def generate_image(prompt: str = Form(...)):
    """
    Generate Image using ComfyUI and Qwen workflow
    """
    try:
        workflow_path = os.path.join("server", "workflows", "image_qwen_image_2512_with_2steps_lora.json")
        if not os.path.exists(workflow_path):
            workflow_path = os.path.join("workflows", "image_qwen_image_2512_with_2steps_lora.json")
            
        with open(workflow_path, "r", encoding="utf-8") as f:
            workflow = json.load(f)
        
        # Inject prompt into Node 108
        if "108" in workflow:
            workflow["108"]["inputs"]["text"] = prompt
            
        # Randomize seed in Node 106
        if "106" in workflow:
            import random
            workflow["106"]["inputs"]["seed"] = random.randint(1, 1125899906842624)
            
        img_content = await call_comfyui_workflow(workflow)
        return StreamingResponse(io.BytesIO(img_content), media_type="image/png")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
