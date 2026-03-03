import os
import io
import uuid
import json
import httpx
import base64
import asyncio
import time
import random
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
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
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

WORKFLOWS_DIR = os.path.join(BASE_DIR, "workflows")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
ASSET_LIBRARY_DIR = os.path.join(BASE_DIR, "assets", "library")
ASSET_LIBRARY_FILES_DIR = os.path.join(ASSET_LIBRARY_DIR, "files")
ASSET_LIBRARY_INDEX_PATH = os.path.join(ASSET_LIBRARY_DIR, "index.json")
MODELS_DIR = os.path.join(BASE_DIR, "models")

DEFAULT_OLLAMA_URL = os.getenv("OLLAMA_URL", "http://192.168.0.67:11434")
DEFAULT_COMFYUI_URL = os.getenv("COMFYUI_URL", "http://localhost:8188")
DEFAULT_WORKFLOW = os.getenv("GENERATE_WORKFLOW", "image_qwen_image_2512_with_2steps_lora.json")
DEFAULT_VISION_MODEL = os.getenv("VISION_MODEL", "llama3.2-vision")

def resolve_path_from_base(raw_path: str, fallback_relative_path: str) -> str:
    """
    Resolve model paths relative to server base dir unless absolute path is provided.
    """
    path = (raw_path or "").strip()
    if not path:
        path = fallback_relative_path
    if os.path.isabs(path):
        return path
    return os.path.join(BASE_DIR, path)

SAM3_MODEL_PATH = resolve_path_from_base(
    os.getenv("SAM3_MODEL_PATH", ""),
    os.path.join("models", "sam3.pt")
)
LEGACY_SAM3_MODEL_PATH = os.path.join(BASE_DIR, "sam3.pt")
if not os.path.exists(SAM3_MODEL_PATH) and os.path.exists(LEGACY_SAM3_MODEL_PATH):
    SAM3_MODEL_PATH = LEGACY_SAM3_MODEL_PATH

def parse_model_list(raw: str, fallback: List[str]) -> List[str]:
    parsed = [m.strip() for m in (raw or "").split(",") if m.strip()]
    return parsed or fallback

DEFAULT_OCR_MODELS = parse_model_list(os.getenv("OCR_MODELS", ""), ["deepseek-ocr:3b"])

def list_available_workflows() -> List[str]:
    if not os.path.isdir(WORKFLOWS_DIR):
        return []
    return sorted(
        f for f in os.listdir(WORKFLOWS_DIR)
        if f.lower().endswith(".json")
    )

def resolve_workflow_path(workflow_name: str) -> Optional[str]:
    if not workflow_name:
        return None
    safe_name = os.path.basename(workflow_name)
    path = os.path.join(WORKFLOWS_DIR, safe_name)
    if os.path.exists(path):
        return path
    return None


def normalize_workflow_name(raw_name: str, workflow_list: List[str]) -> str:
    safe_name = os.path.basename(str(raw_name or "").strip())
    if not safe_name:
        return ""
    if workflow_list and safe_name not in workflow_list:
        return ""
    return safe_name


def get_node_title(node: dict) -> str:
    return str((node.get("_meta") or {}).get("title", "")).lower()


def resolve_node_connection(value):
    if not isinstance(value, (list, tuple)):
        return None
    if len(value) < 1:
        return None
    node_ref = value[0]
    if isinstance(node_ref, str):
        return node_ref
    return None


def is_seed_key(key: str) -> bool:
    key_lower = str(key).lower()
    return (
        key_lower == "seed"
        or key_lower == "noise_seed"
        or key_lower.endswith("_seed")
    )


def apply_prompt_to_workflow(workflow: dict, prompt: str) -> bool:
    if not isinstance(workflow, dict):
        return False

    nodes = [(node_id, node) for node_id, node in workflow.items() if isinstance(node, dict)]
    if not nodes:
        return False

    clip_text_inputs = []
    primitive_candidates = []

    for node_id, node in nodes:
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue

        class_type = str(node.get("class_type", "")).lower()
        title = get_node_title(node)

        if "cliptextencode" in class_type and "text" in inputs:
            src = resolve_node_connection(inputs.get("text"))
            if src:
                clip_text_inputs.append((node_id, src, "connected", "negative" in title))
            elif isinstance(inputs.get("text"), str):
                clip_text_inputs.append((node_id, None, "inline", "negative" in title))

        if "primitive" in class_type and "string" in class_type and "value" in inputs:
            if isinstance(inputs.get("value"), str):
                primitive_candidates.append((node_id, node_id in [src for _, src, _, _ in clip_text_inputs], "negative" in title))

    # Prefer primitive string nodes connected to non-negative CLIP text encode first.
    positive_linked = {src for _, src, src_type, is_negative in clip_text_inputs if src and not is_negative}
    if positive_linked:
        changed = False
        for node_id, _, _ in [(n, None, None) for n in positive_linked]:
            node = workflow.get(node_id)
            inputs = node.get("inputs", {}) if isinstance(node, dict) else {}
            if isinstance(inputs, dict) and isinstance(inputs.get("value"), str):
                inputs["value"] = prompt
                changed = True
        if changed:
            return True

    # Fallback to non-negative primitive string nodes.
    for node_id, _, is_negative in primitive_candidates:
        if is_negative:
            continue
        node = workflow.get(node_id, {})
        inputs = node.get("inputs", {})
        if isinstance(inputs, dict) and "value" in inputs and isinstance(inputs["value"], str):
            inputs["value"] = prompt
            return True

    # Fallback to direct inline text fields on CLIP text encode nodes.
    for node_id, _, _, is_negative in clip_text_inputs:
        if is_negative:
            continue
        node = workflow.get(node_id, {})
        inputs = node.get("inputs", {})
        if isinstance(inputs, dict) and "text" in inputs and isinstance(inputs["text"], str):
            inputs["text"] = prompt
            return True

    # Last resort: update every string-like value field
    # (except obviously negative prompt text when detectable).
    for _, node in nodes:
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        title = get_node_title(node)
        if "negative" in title:
            continue
        for key in ("value", "text"):
            if key in inputs and isinstance(inputs[key], str):
                inputs[key] = prompt
                return True

    return False


def apply_t2i_prompt(workflow: dict, prompt: str) -> bool:
    if not isinstance(workflow, dict) or not isinstance(prompt, str):
        return False

    nodes = [(node_id, node) for node_id, node in workflow.items() if isinstance(node, dict)]
    if not nodes:
        return False

    # Preferred: dedicated prompt field in text-to-image workflows.
    for node_id, node in nodes:
        class_type = str(node.get("class_type", "")).lower()
        title = get_node_title(node)
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if class_type == "primitivestringmultiline" and "value" in inputs and isinstance(inputs["value"], str):
            if "prompt" in title:
                inputs["value"] = prompt
                return True

    # Fallback: connected CLIP positive node -> source primitive string.
    for node_id, node in nodes:
        class_type = str(node.get("class_type", "")).lower()
        title = get_node_title(node)
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if class_type != "cliptextencode" or "positive" not in title:
            continue
        text_value = inputs.get("text")
        if isinstance(text_value, str):
            inputs["text"] = prompt
            return True
        if isinstance(text_value, (list, tuple)) and len(text_value) > 0 and isinstance(text_value[0], str):
            source_id = text_value[0]
            source_node = workflow.get(source_id)
            if isinstance(source_node, dict):
                source_inputs = source_node.get("inputs")
                if isinstance(source_inputs, dict) and isinstance(source_inputs.get("value"), str):
                    source_inputs["value"] = prompt
                    return True

    # Last fallback: any primitive string field
    for node_id, node in nodes:
        class_type = str(node.get("class_type", "")).lower()
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if ("primitive" not in class_type and "string" not in class_type) or "value" not in inputs:
            continue
        if isinstance(inputs["value"], str):
            inputs["value"] = prompt
            return True

    return False


def apply_i2i_prompt(workflow: dict, prompt: str) -> bool:
    if not isinstance(workflow, dict) or not isinstance(prompt, str):
        return False

    nodes = [(node_id, node) for node_id, node in workflow.items() if isinstance(node, dict)]
    if not nodes:
        return False

    # Prefer explicit positive CLIP text field.
    for node_id, node in nodes:
        class_type = str(node.get("class_type", "")).lower()
        title = get_node_title(node)
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if class_type != "cliptextencode" or "positive" not in title:
            continue
        if "text" in inputs and isinstance(inputs["text"], str):
            inputs["text"] = prompt
            return True
        text_value = inputs.get("text")
        if isinstance(text_value, (list, tuple)) and len(text_value) > 0 and isinstance(text_value[0], str):
            source_id = text_value[0]
            source_node = workflow.get(source_id)
            if isinstance(source_node, dict):
                source_inputs = source_node.get("inputs")
                if isinstance(source_inputs, dict) and isinstance(source_inputs.get("value"), str):
                    source_inputs["value"] = prompt
                    return True

    # Fallback: positive primitive string fields with prompt in title
    for node_id, node in nodes:
        class_type = str(node.get("class_type", "")).lower()
        title = get_node_title(node)
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if "primitive" not in class_type or "value" not in inputs or not isinstance(inputs["value"], str):
            continue
        if "prompt" in title or "positive" in title:
            inputs["value"] = prompt
            return True

    # Last fallback: any primitive string field.
    for _, node in nodes:
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if "value" in inputs and isinstance(inputs["value"], str):
            inputs["value"] = prompt
            return True

    return False


def apply_mode_specific_inputs(
    workflow: dict,
    mode: str,
    prompt: str,
    source_image_name: Optional[str] = None,
    source_image_names: Optional[List[str]] = None,
) -> dict:
    if not isinstance(workflow, dict) or not isinstance(prompt, str):
        return {"prompt": False, "image_count": 0}

    changed_targets = {"prompt": False, "image_count": 0}
    selected_mode = str(mode or "t2i").lower()
    is_i2i_mode = selected_mode in {"i2i", "i2i_single", "i2i_multi"}

    source_images: List[str] = []
    if source_image_name:
        source_images.append(source_image_name)
    if isinstance(source_image_names, list):
        for filename in source_image_names:
            if isinstance(filename, str):
                filename = filename.strip()
                if filename:
                    source_images.append(filename)

    if is_i2i_mode:
        if source_images:
            changed_targets["image_count"] = apply_images_to_workflow(workflow, source_images)
        if apply_i2i_prompt(workflow, prompt):
            changed_targets["prompt"] = True
        return changed_targets

    if selected_mode == "t2i":
        if apply_t2i_prompt(workflow, prompt):
            changed_targets["prompt"] = True
        return changed_targets

    if apply_prompt_to_workflow(workflow, prompt):
        changed_targets["prompt"] = True
    return changed_targets


def randomize_seed_nodes(workflow: dict, seed: int):
    if not isinstance(workflow, dict):
        return
    for _, node in workflow.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for key, value in inputs.items():
            if is_seed_key(key) and isinstance(value, int):
                inputs[key] = seed


def collect_loadimage_image_fields(workflow: dict) -> list:
    if not isinstance(workflow, dict):
        return []

    fields = []
    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        if str(node.get("class_type", "")).lower() != "loadimage":
            continue

        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue

        for key, value in inputs.items():
            if not str(key).lower().startswith("image"):
                continue
            if isinstance(value, str):
                fields.append((node_id, key, inputs))
    return fields


def apply_images_to_workflow(workflow: dict, image_filenames: List[str]) -> int:
    if not isinstance(workflow, dict) or not isinstance(image_filenames, list):
        return 0

    fields = collect_loadimage_image_fields(workflow)
    if not fields:
        return 0

    mapped_count = 0
    for filename, (node_id, key, inputs) in zip(image_filenames, fields):
        filename = str(filename).strip()
        if not filename:
            continue
        inputs[key] = filename
        mapped_count += 1
        print(f"[generate-image] mapped source image '{filename}' -> node {node_id} field {key}")

    return mapped_count


def apply_image_to_workflow(workflow: dict, image_filename: str) -> bool:
    if not isinstance(workflow, dict) or not isinstance(image_filename, str):
        return False

    image_filename = image_filename.strip()
    if not image_filename:
        return False

    return apply_images_to_workflow(workflow, [image_filename]) > 0


def describe_loadimage_nodes(workflow: dict) -> list:
    if not isinstance(workflow, dict):
        return []

    nodes = []
    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        if str(node.get("class_type", "")).lower() != "loadimage":
            continue

        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue

        image_fields = []
        for key, value in inputs.items():
            if str(key).lower().startswith("image") and isinstance(value, str):
                image_fields.append({key: value})

        nodes.append({
            "node_id": str(node_id),
            "title": ((node.get("_meta") or {}).get("title") or "").strip(),
            "image_fields": image_fields,
        })

    return nodes


def _extract_comfy_upload_name(payload):
    if not isinstance(payload, dict):
        return None

    for key in ("name", "filename", "file_name"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            subfolder = payload.get("subfolder")
            if not isinstance(subfolder, str):
                subfolder = payload.get("subfolder_name")
            if not isinstance(subfolder, str) or not subfolder.strip():
                return value.strip()
            normalized_subfolder = subfolder.strip().replace("\\", "/").strip("/")
            if not normalized_subfolder:
                return value.strip()
            return f"{normalized_subfolder}/{value.strip()}"

    return None


async def upload_image_to_comfyui(source_image: UploadFile, subfolder: str = "") -> str:
    image_data = await source_image.read()
    if not image_data:
        raise HTTPException(status_code=400, detail="Source image is empty.")

    safe_filename = source_image.filename or "source.png"
    content_type = source_image.content_type or "image/png"
    files = {
        "image": (safe_filename, image_data, content_type),
    }
    data = {
        "overwrite": "true",
        "type": "input",
        "subfolder": subfolder or "",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        upload_res = await client.post(
            f"{COMFYUI_URL}/upload/image",
            files=files,
            data=data,
        )

    if upload_res.status_code != 200:
        raise HTTPException(status_code=502, detail=f"ComfyUI image upload failed: {upload_res.text}")

    try:
        upload_json = upload_res.json()
    except Exception:
        raise HTTPException(status_code=502, detail="ComfyUI image upload response is not JSON.")

    uploaded_filename = _extract_comfy_upload_name(upload_json)
    if not uploaded_filename:
        raise HTTPException(status_code=502, detail="ComfyUI image upload response does not include filename.")

    print(f"[generate-image] ComfyUI upload response: {upload_json} -> source image '{uploaded_filename}'")
    return uploaded_filename

def read_persisted_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}

def write_persisted_config():
    payload = {
        "ollama": OLLAMA_URL,
        "comfyui": COMFYUI_URL,
        "workflow": GENERATE_WORKFLOW,
        "workflow_map": WORKFLOW_MAP,
        "ocr_model": OCR_MODEL,
    }
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

persisted_config = read_persisted_config()
OLLAMA_URL = persisted_config.get("ollama", DEFAULT_OLLAMA_URL)
COMFYUI_URL = persisted_config.get("comfyui", DEFAULT_COMFYUI_URL)

workflow_options = list_available_workflows()
workflow_map_from_config = persisted_config.get("workflow_map")
if not isinstance(workflow_map_from_config, dict):
    workflow_map_from_config = {}
legacy_i2i_workflow = normalize_workflow_name(
    os.path.basename(str(workflow_map_from_config.get("i2i", "")).strip()),
    workflow_options,
)

WORKFLOW_MAP = {
    "t2i": normalize_workflow_name(
        workflow_map_from_config.get("t2i", persisted_config.get("workflow", DEFAULT_WORKFLOW)),
        workflow_options,
    ),
    "i2i_single": normalize_workflow_name(
        workflow_map_from_config.get("i2i_single", legacy_i2i_workflow),
        workflow_options,
    ),
    "i2i_multi": normalize_workflow_name(workflow_map_from_config.get("i2i_multi", ""), workflow_options),
    "upscale": normalize_workflow_name(workflow_map_from_config.get("upscale", ""), workflow_options),
}

if workflow_options and not WORKFLOW_MAP["t2i"]:
    WORKFLOW_MAP["t2i"] = workflow_options[0]

GENERATE_WORKFLOW = WORKFLOW_MAP["t2i"]

OCR_MODEL = persisted_config.get("ocr_model", DEFAULT_OCR_MODELS[0])
if OCR_MODEL not in DEFAULT_OCR_MODELS:
    OCR_MODEL = DEFAULT_OCR_MODELS[0]

VISION_MODEL = DEFAULT_VISION_MODEL

def build_config_response() -> dict:
    return {
        "config": {
            "ollama": OLLAMA_URL,
            "comfyui": COMFYUI_URL,
            "workflow": GENERATE_WORKFLOW,
            "workflow_map": WORKFLOW_MAP,
            "ocr_model": OCR_MODEL,
        },
        "options": {
            "workflows": list_available_workflows(),
            "ocr_models": DEFAULT_OCR_MODELS,
        },
    }

def ensure_asset_library_storage():
    os.makedirs(ASSET_LIBRARY_FILES_DIR, exist_ok=True)
    if not os.path.exists(ASSET_LIBRARY_INDEX_PATH):
        with open(ASSET_LIBRARY_INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False, indent=2)

def read_asset_library_index() -> List[dict]:
    ensure_asset_library_storage()
    try:
        with open(ASSET_LIBRARY_INDEX_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, list) else []
    except Exception:
        return []

def write_asset_library_index(items: List[dict]):
    ensure_asset_library_storage()
    with open(ASSET_LIBRARY_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

# Initialize rembg session for persistent model loading
try:
    rembg_session = new_session()
except Exception:
    rembg_session = None

# Initialize SAM 3 models
try:
    # 1. Standard SAM model for single object (points/boxes)
    sam3_model = SAM(SAM3_MODEL_PATH)
    
    # 2. Semantic Predictor for concept segmentation (text)
    overrides = dict(conf=0.25, task="segment", mode="predict", model=SAM3_MODEL_PATH, save=False)
    sam3_predictor = SAM3SemanticPredictor(overrides=overrides)
except Exception as e:
    print(f"SAM 3 models initialization failed (path: {SAM3_MODEL_PATH}): {e}")
    sam3_model = None
    sam3_predictor = None

app = FastAPI(title="Open Lovart AI Orchestrator")
ensure_asset_library_storage()
app.mount("/assets/files", StaticFiles(directory=ASSET_LIBRARY_FILES_DIR), name="asset_files")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def call_comfyui_workflow(workflow: dict, timeout_sec: int = 180):
    """
    Helper to send a workflow to ComfyUI and wait for results (simplified)
    """
    client_id = str(uuid.uuid4())
    started_at = asyncio.get_running_loop().time()
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Queue Prompt
        prompt_res = await client.post(
            f"{COMFYUI_URL}/prompt", 
            json={"prompt": workflow, "client_id": client_id}
        )
        if prompt_res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"ComfyUI prompt failed: {prompt_res.text}")
        prompt_id = prompt_res.json().get("prompt_id")
        if not prompt_id:
            raise HTTPException(status_code=502, detail="ComfyUI did not return prompt_id.")
        
        # 2. Wait for completion (Polling - in a real app, use WebSockets)
        while True:
            history_res = await client.get(f"{COMFYUI_URL}/history/{prompt_id}")
            if history_res.status_code != 200:
                raise HTTPException(status_code=502, detail=f"ComfyUI history failed: {history_res.text}")
            history = history_res.json()
            if prompt_id in history:
                # Get the image filename from history
                outputs = history[prompt_id].get("outputs", {})
                for node_id in outputs:
                    if "images" in outputs[node_id]:
                        image_info = outputs[node_id]["images"][0]
                        filename = image_info.get("filename")
                        if not filename:
                            continue
                        # 3. Fetch final image
                        img_res = await client.get(
                            f"{COMFYUI_URL}/view",
                            params={
                                "filename": filename,
                                "subfolder": image_info.get("subfolder", ""),
                                "type": image_info.get("type", "output"),
                            },
                        )
                        if img_res.status_code != 200:
                            raise HTTPException(status_code=502, detail=f"ComfyUI image fetch failed: {img_res.text}")
                        return img_res.content
            if asyncio.get_running_loop().time() - started_at > timeout_sec:
                raise HTTPException(status_code=504, detail="ComfyUI generation timed out.")
            await asyncio.sleep(0.5)

@app.get("/")
async def root():
    return {
        "status": "online",
        **build_config_response()
    }

@app.get("/config")
async def get_config():
    return build_config_response()

@app.put("/config/update")
async def update_config(data: dict):
    global OLLAMA_URL, COMFYUI_URL, GENERATE_WORKFLOW, OCR_MODEL, WORKFLOW_MAP

    workflows = list_available_workflows()

    ollama = str(data.get("ollama", OLLAMA_URL)).strip()
    comfyui = str(data.get("comfyui", COMFYUI_URL)).strip()
    legacy_workflow = os.path.basename(str(data.get("workflow", GENERATE_WORKFLOW)).strip())
    raw_workflow_map = data.get("workflow_map")
    if not isinstance(raw_workflow_map, dict):
        raw_workflow_map = {}

    legacy_i2i = os.path.basename(str(raw_workflow_map.get("i2i", "").strip()))

    workflow = {
        "t2i": os.path.basename(str(raw_workflow_map.get("t2i", legacy_workflow)).strip()),
        "i2i_single": os.path.basename(str(raw_workflow_map.get("i2i_single", legacy_i2i)).strip()),
        "i2i_multi": os.path.basename(str(raw_workflow_map.get("i2i_multi", "")).strip()),
        "upscale": os.path.basename(str(raw_workflow_map.get("upscale", "")).strip()),
    }
    ocr_model = str(data.get("ocr_model", data.get("ocrModel", OCR_MODEL))).strip()

    if workflows and workflow["t2i"] and workflow["t2i"] not in workflows:
        raise HTTPException(status_code=400, detail="Invalid workflow selection for T2I.")
    if workflows and workflow["i2i_single"] and workflow["i2i_single"] not in workflows:
        raise HTTPException(status_code=400, detail="Invalid workflow selection for I2I (Single).")
    if workflows and workflow["i2i_multi"] and workflow["i2i_multi"] not in workflows:
        raise HTTPException(status_code=400, detail="Invalid workflow selection for I2I (Multi).")
    if workflows and workflow["upscale"] and workflow["upscale"] not in workflows:
        raise HTTPException(status_code=400, detail="Invalid workflow selection for Upscale.")
    if ocr_model not in DEFAULT_OCR_MODELS:
        raise HTTPException(status_code=400, detail="Invalid OCR model selection.")

    OLLAMA_URL = ollama or OLLAMA_URL
    COMFYUI_URL = comfyui or COMFYUI_URL
    if not workflow["t2i"] and workflows:
        raise HTTPException(status_code=400, detail="T2I workflow is required.")

    if not workflows:
        WORKFLOW_MAP = {"t2i": "", "i2i_single": "", "i2i_multi": "", "upscale": ""}
    else:
        WORKFLOW_MAP = {
            "t2i": workflow["t2i"] if workflow["t2i"] else WORKFLOW_MAP["t2i"],
            "i2i_single": workflow["i2i_single"],
            "i2i_multi": workflow["i2i_multi"],
            "upscale": workflow["upscale"],
        }
    GENERATE_WORKFLOW = WORKFLOW_MAP["t2i"]
    OCR_MODEL = ocr_model
    write_persisted_config()

    return {"status": "success", **build_config_response()}

@app.get("/assets")
async def list_assets():
    items = read_asset_library_index()
    items = sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)
    return {"items": items}

@app.post("/assets/upload")
async def upload_asset(
    file: UploadFile = File(...),
    source: str = Form("manual"),
    prompt: str = Form(""),
    name: str = Form(""),
):
    try:
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image files can be added to library.")

        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]:
            ext = ".png"

        asset_id = uuid.uuid4().hex
        saved_name = f"{asset_id}{ext}"
        saved_path = os.path.join(ASSET_LIBRARY_FILES_DIR, saved_name)
        with open(saved_path, "wb") as out:
            out.write(raw)

        width, height = None, None
        try:
            with Image.open(io.BytesIO(raw)) as img:
                width, height = img.size
        except Exception:
            pass

        item = {
            "id": asset_id,
            "name": (name or file.filename or saved_name).strip(),
            "source": (source or "manual").strip(),
            "prompt": (prompt or "").strip(),
            "created_at": int(time.time() * 1000),
            "filename": saved_name,
            "url": f"/assets/files/{saved_name}",
            "content_type": file.content_type,
            "width": width,
            "height": height,
        }

        items = read_asset_library_index()
        items.insert(0, item)
        write_asset_library_index(items)
        return {"item": item}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save asset: {str(e)}")


@app.patch("/assets/{asset_id}")
@app.put("/assets/{asset_id}")
async def rename_asset(asset_id: str, data: dict):
    items = read_asset_library_index()
    target = next((item for item in items if item.get("id") == asset_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Asset not found.")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request payload.")

    raw_name = data.get("name")
    if raw_name is None:
        raise HTTPException(status_code=400, detail="name is required.")

    next_name = str(raw_name).strip()
    if not next_name:
        next_name = "Untitled"

    target["name"] = next_name
    write_asset_library_index(items)
    return {"item": target}

@app.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str):
    items = read_asset_library_index()
    target = next((x for x in items if x.get("id") == asset_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Asset not found.")

    filename = target.get("filename", "")
    if filename:
        safe_name = os.path.basename(filename)
        file_path = os.path.join(ASSET_LIBRARY_FILES_DIR, safe_name)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to delete asset file: {str(e)}")

    next_items = [x for x in items if x.get("id") != asset_id]
    write_asset_library_index(next_items)
    return {"status": "success", "deleted_id": asset_id}

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
            if pts:
                query_args["points"] = pts
                query_args["labels"] = lbls
            elif boxes:
                query_args["bboxes"] = boxes
            results = sam3_predictor(**query_args)
        else:
            # Single Object Mode (SAM 2 Compatibility)
            print("Mode: Single Object Segmentation (SAM.predict)")
            predict_args = {
                "source": img_np,
                "device": "cuda" if torch.cuda.is_available() else "cpu",
                "conf": 0.25
            }
            if pts:
                predict_args["points"] = pts
                predict_args["labels"] = lbls
            elif boxes:
                # SAM.predict expects bboxes=[x1, y1, x2, y2] or list of lists
                predict_args["bboxes"] = boxes[0] if len(boxes) == 1 else boxes
            
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
            "model": OCR_MODEL,
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
        "model": VISION_MODEL,
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
async def generate_image(
    prompt: str = Form(...),
    workflow: str = Form(default=""),
    mode: str = Form(default="t2i"),
    source_image: UploadFile = File(default=None),
    source_images: List[UploadFile] = File(default=[]),
):
    """
    Generate Image using ComfyUI and Qwen workflow
    """
    try:
        requested_workflow = workflow.strip() if workflow else ""
        selected_mode = mode.strip().lower() if mode else "t2i"
        if selected_mode == "i2i":
            selected_mode = "i2i_single"
        is_i2i_mode = selected_mode in {"i2i_single", "i2i_multi"}

        if not requested_workflow:
            requested_workflow = (WORKFLOW_MAP.get(selected_mode) if WORKFLOW_MAP else "")
        if not requested_workflow and is_i2i_mode and selected_mode in WORKFLOW_MAP:
            raise HTTPException(status_code=400, detail=f"No workflow mapped for {selected_mode}. Select one in Settings > ComfyUI.")
        if not requested_workflow:
            requested_workflow = GENERATE_WORKFLOW

        workflow_path = resolve_workflow_path(requested_workflow)
        if not workflow_path:
            raise HTTPException(status_code=500, detail="Generate workflow is not configured.")

        with open(workflow_path, "r", encoding="utf-8") as f:
            workflow_data = json.load(f)

        source_image_names = []
        if is_i2i_mode:
            if selected_mode == "i2i_multi":
                multi_source_images: List[UploadFile] = []
                if source_images:
                    multi_source_images = source_images
                elif source_image:
                    multi_source_images = [source_image]
                if len(multi_source_images) < 2:
                    raise HTTPException(
                        status_code=400,
                        detail="I2I (Multi) generation requires at least 2 image sources. Select two or more image layers.",
                    )
            else:
                multi_source_images = [source_image] if source_image else []
                if not multi_source_images:
                    raise HTTPException(
                        status_code=400,
                        detail="I2I generation requires an image source. Select one image layer on canvas.",
                    )

            for source in multi_source_images:
                if source is None:
                    continue
                source_image_names.append(await upload_image_to_comfyui(source))

            if not source_image_names:
                raise HTTPException(
                    status_code=400,
                    detail="I2I image upload failed.",
                )

        changed_targets = apply_mode_specific_inputs(
            workflow_data,
            selected_mode,
            prompt,
            source_image_names=source_image_names,
        )
        if not changed_targets["prompt"] and not apply_prompt_to_workflow(workflow_data, prompt):
            print(f"[generate-image] Warning: could not find a recognized prompt target in workflow '{requested_workflow}'.")

        if is_i2i_mode:
            if selected_mode == "i2i_multi" and len(source_image_names) < 2:
                raise HTTPException(
                    status_code=400,
                    detail="I2I (Multi) generation requires at least 2 image sources. Select two or more image layers.",
                )
            if not changed_targets["image_count"]:
                loadimage_nodes = describe_loadimage_nodes(workflow_data)
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not map source image(s) into workflow. Configure a workflow with a LoadImage node. Current nodes: {loadimage_nodes}",
                )
            if changed_targets["image_count"] < len(source_image_names):
                raise HTTPException(
                    status_code=400,
                    detail="Could not map all source images into workflow. Configure a workflow with enough image input fields.",
                )
            loadimage_nodes = describe_loadimage_nodes(workflow_data)
            print(f"[generate-image] I2I source mapped: {source_image_names}, loadimage_nodes={loadimage_nodes}")

        randomize_seed_nodes(workflow_data, random.randint(1, 1125899906842624))

        img_content = await call_comfyui_workflow(workflow_data)
        return StreamingResponse(io.BytesIO(img_content), media_type="image/png")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
