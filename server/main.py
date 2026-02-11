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

# Load configurations
load_dotenv()
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://localhost:8188")

# Initialize rembg session for persistent model loading
try:
    rembg_session = new_session()
except Exception:
    rembg_session = None

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
    points: str = Form(...), 
    labels: str = Form("[]") 
):
    """
    Segment Object using SAM
    """
    # This involves:
    # 1. Loading the image (PIL)
    # 2. Running SAM inference (local or via ComfyUI SAM node)
    # 3. Generating a mask
    # 4. Returning the cropped segment
    return {"message": "SAM Integration in progress. Use marks coordinates for inference."}

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
