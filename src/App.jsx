import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, MousePointer2, Square, Type, Image as ImageIcon, Maximize,
  Layers as LayersIcon, Settings, Download, Trash2, Eye, EyeOff, Eraser, Circle,
  MoreHorizontal, Sparkles, Scissors, Target, Edit3, RotateCcw,
  RotateCw, Undo2, Redo2, Grid, Search, Hand, AlignLeft, AlignCenter,
  AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, Group, Ungroup, Bold, Italic, Type as TypeIcon,
  ChevronUp, ChevronDown
} from 'lucide-react';
import * as fabric from 'fabric';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WORLD_CANVAS_WIDTH = 5000;
const WORLD_CANVAS_HEIGHT = 5000;
const SHORTCUT_DEFINITIONS = [
  { id: 'select', label: 'Selection', key: 'v', keyLabel: 'V' },
  { id: 'pan', label: 'Hand / Pan', key: 'h', keyLabel: 'H' },
  { id: 'panHold', label: 'Pan (Hold)', keyLabel: 'Space', displayOnly: true },
  { id: 'mark', label: 'Mark', key: 'm', keyLabel: 'M' },
  { id: 'eraser', label: 'Eraser', key: 'e', keyLabel: 'E' },
  { id: 'rect', label: 'Rectangle', key: 'r', keyLabel: 'R' },
  { id: 'circle', label: 'Circle', key: 'o', keyLabel: 'O' },
  { id: 'text', label: 'Text', key: 't', keyLabel: 'T' },
  { id: 'imageUpload', label: 'Image Upload', key: 'i', keyLabel: 'I' },
  { id: 'undo', label: 'Undo', key: 'z', keyLabel: 'Ctrl + Z', ctrl: true },
  { id: 'redo', label: 'Redo', key: 'y', keyLabel: 'Ctrl + Y', ctrl: true },
  { id: 'toggleShortcuts', label: 'Toggle This Help', key: '?', keyLabel: '?' },
];

const App = () => {
  // --- States ---
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [marks, setMarks] = useState([]);
  const [promptBox, setPromptBox] = useState(null); // [x1, y1, x2, y2]
  const [showAiInput, setShowAiInput] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);
  const [canvasBg, setCanvasBg] = useState('#ffffff');
  const [renamingId, setRenamingId] = useState(null);
  const [draggedLayerIndex, setDraggedLayerIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [showRemoveBgConfirm, setShowRemoveBgConfirm] = useState(false);
  const [showSegmentModal, setShowSegmentModal] = useState(false);
  const [segmentText, setSegmentText] = useState('');
  const [segmentTarget, setSegmentTarget] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [eraserSize, setEraserSize] = useState(28);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isLibrarySaving, setIsLibrarySaving] = useState(false);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState(null);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState('properties');
  const [activePropsTab, setActivePropsTab] = useState('image');
  const [showAlignmentHint, setShowAlignmentHint] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('png');
  const [settingsOptions, setSettingsOptions] = useState({
    workflows: [],
    ocrModels: [],
    visionModels: [],
  });
  const [settingsDraft, setSettingsDraft] = useState({
    ollama: '',
    comfyui: '',
    workflow: '',
    ocrModel: '',
    visionModel: '',
  });

  // --- Refs ---
  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);
  const canvasContainerRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const marksRef = useRef(marks);
  const isSavingHistory = useRef(false);
  const alignmentHintTimerRef = useRef(null);
  const dragCounter = useRef(0);
  const isSpacePanRef = useRef(false);
  const eraserSizeRef = useRef(eraserSize);
  const eraserCursorRef = useRef(null);
  const imageInputRef = useRef(null);

  // --- Sync Refs ---
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { marksRef.current = marks; }, [marks]);
  useEffect(() => { eraserSizeRef.current = eraserSize; }, [eraserSize]);
  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    if (activeTool === 'eraser') {
      canvas.selection = false;
      canvas.skipTargetFind = true;
      canvas.upperCanvasEl.style.cursor = 'none';
      return;
    }
    canvas.skipTargetFind = false;
    if (activeTool === 'pan') {
      canvas.upperCanvasEl.style.cursor = 'grab';
      if (eraserCursorRef.current) eraserCursorRef.current.style.display = 'none';
      return;
    }
    canvas.selection = true;
    canvas.upperCanvasEl.style.cursor = '';
    if (eraserCursorRef.current) eraserCursorRef.current.style.display = 'none';
  }, [activeTool]);
  useEffect(() => {
    if (!selectedObject) return;
    if (selectedObject.type === 'i-text' || selectedObject.type === 'text') {
      setActivePropsTab('text');
      return;
    }
    if (selectedObject.type === 'rect') {
      setActivePropsTab('shape');
      return;
    }
    if (selectedObject.type === 'FabricImage' || selectedObject.type === 'image') {
      setActivePropsTab('image');
    }
  }, [selectedObject?.type]);

  const syncUI = useCallback(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const objs = canvas.getObjects()
      .filter(obj => obj.id !== 'temp-prompt-box' && obj.id !== 'world-bounds')
      .map((obj, index) => ({
        id: obj.id || (obj.id = Math.random().toString(36).substr(2, 9)),
        name: obj.name || `${obj.type} ${index + 1}`,
        visible: obj.visible,
        active: canvas.getActiveObjects().includes(obj),
        object: obj,
        type: obj.type,
        index: index
      })).reverse();
    setLayers(objs);

    const activeObj = canvas.getActiveObject();
    const activeObjects = canvas.getActiveObjects();

    if (activeObj) {
      setSelectedObject({
        type: activeObj.type,
        fill: activeObj.fill,
        opacity: activeObj.opacity,
        left: Math.round(activeObj.left),
        top: Math.round(activeObj.top),
        scaleX: activeObj.scaleX,
        scaleY: activeObj.scaleY,
        angle: activeObj.angle,
        id: activeObj.id,
        name: activeObj.name,
        isMultiple: activeObjects.length > 1,
        isGroup: activeObj.type === 'group',
        fontFamily: activeObj.fontFamily || 'Inter',
        fontWeight: activeObj.fontWeight || 'normal',
        fontStyle: activeObj.fontStyle || 'normal',
        fontSize: Math.round((activeObj.fontSize || 20) * (activeObj.scaleX || 1)),
        brightness: activeObj.filters?.find(f => f.type === 'Brightness')?.brightness || 0,
        contrast: activeObj.filters?.find(f => f.type === 'Contrast')?.contrast || 0,
        grayscale: activeObj.filters?.some(f => f.type === 'Grayscale') || false,
      });
    } else {
      setSelectedObject(null);
    }
  }, []);

  const syncArtboardPattern = useCallback(() => {
    const canvas = fabricCanvas.current;
    const artboard = canvasContainerRef.current;
    if (!canvas || !artboard || !canvas.viewportTransform) return;

    const vpt = canvas.viewportTransform;
    const scale = vpt[0] || 1;
    const dotGap = Math.max(18, 36 * scale);
    const dotSize = Math.max(1.25, 2 * scale);

    artboard.style.setProperty('--dot-gap', `${dotGap}px`);
    artboard.style.setProperty('--dot-size', `${dotSize}px`);
    artboard.style.setProperty('--dot-offset-x', `${vpt[4]}px`);
    artboard.style.setProperty('--dot-offset-y', `${vpt[5]}px`);
  }, []);

  const getCreationCenterInScene = useCallback(() => {
    const canvas = fabricCanvas.current;
    const artboard = canvasContainerRef.current;
    if (!canvas || !artboard) return new fabric.Point(0, 0);

    const canvasW = canvas.getWidth() || 0;
    const canvasH = canvas.getHeight() || 0;
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const zoomX = vpt[0] || 1;
    const zoomY = vpt[3] || zoomX;

    let visibleLeft = 0;
    let visibleRight = canvasW;

    const artboardRect = artboard.getBoundingClientRect();
    const sidebarRect = document.querySelector('.sidebar')?.getBoundingClientRect();
    const panelRect = document.querySelector('.control-panel')?.getBoundingClientRect();

    if (sidebarRect) {
      visibleLeft = Math.max(visibleLeft, sidebarRect.right - artboardRect.left + 12);
    }
    if (panelRect) {
      visibleRight = Math.min(visibleRight, panelRect.left - artboardRect.left - 12);
    }

    if (visibleRight <= visibleLeft) {
      visibleLeft = 0;
      visibleRight = canvasW;
    }

    const viewportCenterX = (visibleLeft + visibleRight) / 2;
    const viewportCenterY = canvasH / 2;
    const sceneX = (viewportCenterX - vpt[4]) / zoomX;
    const sceneY = (viewportCenterY - vpt[5]) / zoomY;

    return new fabric.Point(sceneX, sceneY);
  }, []);

  const loadServerSettings = useCallback(async () => {
    setIsSettingsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/config`);
      let data = null;

      if (response.status === 404) {
        // Backward compatibility: older backend may not have /config
        const legacyResponse = await fetch(`${API_BASE_URL}/`);
        if (!legacyResponse.ok) throw new Error('Failed to load server config');
        const legacy = await legacyResponse.json();
        const legacyConfig = legacy.config || {};
        data = {
          config: {
            ollama: legacyConfig.ollama || '',
            comfyui: legacyConfig.comfyui || '',
            workflow: '',
            ocr_model: '',
            vision_model: '',
          },
          options: {
            workflows: [],
            ocr_models: [],
            vision_models: [],
          },
        };
      } else {
        if (!response.ok) throw new Error('Failed to load server config');
        data = await response.json();
      }

      const config = data.config || {};
      const options = data.options || {};
      setSettingsDraft({
        ollama: config.ollama || '',
        comfyui: config.comfyui || '',
        workflow: config.workflow || '',
        ocrModel: config.ocr_model || '',
        visionModel: config.vision_model || '',
      });
      setSettingsOptions({
        workflows: options.workflows || [],
        ocrModels: options.ocr_models || [],
        visionModels: options.vision_models || [],
      });
    } catch (err) {
      console.error(err);
      // Avoid blocking popup on first-load failures.
    } finally {
      setIsSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showSettingsModal) loadServerSettings();
  }, [showSettingsModal, loadServerSettings]);

  const saveServerSettings = async () => {
    setIsSettingsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/config/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama: settingsDraft.ollama,
          comfyui: settingsDraft.comfyui,
          workflow: settingsDraft.workflow,
          ocr_model: settingsDraft.ocrModel,
          vision_model: settingsDraft.visionModel,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save settings');
      }

      const data = await response.json();
      const config = data.config || {};
      const options = data.options || {};
      setSettingsDraft({
        ollama: config.ollama || '',
        comfyui: config.comfyui || '',
        workflow: config.workflow || '',
        ocrModel: config.ocr_model || '',
        visionModel: config.vision_model || '',
      });
      setSettingsOptions({
        workflows: options.workflows || [],
        ocrModels: options.ocr_models || [],
        visionModels: options.vision_models || [],
      });
      setShowSettingsModal(false);
    } catch (err) {
      console.error(err);
      alert('Settings save failed: ' + err.message);
    } finally {
      setIsSettingsSaving(false);
    }
  };

  const toAbsoluteAssetUrl = useCallback((assetUrl) => {
    if (!assetUrl) return '';
    if (/^https?:\/\//i.test(assetUrl)) return assetUrl;
    return `${API_BASE_URL}${assetUrl.startsWith('/') ? '' : '/'}${assetUrl}`;
  }, []);

  const loadFabricImage = async (url) => {
    const isRemoteUrl = typeof url === 'string' && /^https?:\/\//i.test(url);
    return fabric.FabricImage.fromURL(url, isRemoteUrl ? { crossOrigin: 'anonymous' } : {});
  };

  const loadAssetLibrary = useCallback(async () => {
    setIsLibraryLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/assets`);
      if (!response.ok) throw new Error('Failed to load assets');
      const data = await response.json();
      setAssetLibrary(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssetLibrary();
  }, [loadAssetLibrary]);

  const addImageFromAsset = async (asset) => {
    if (!asset?.url) return;
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    try {
      const img = await loadFabricImage(toAbsoluteAssetUrl(asset.url));
      if ((img.width || 0) > 500) img.scaleToWidth(500);
      img.name = asset.name || 'Library Asset';
      canvas.add(img);
      const sceneCenter = getCreationCenterInScene();
      img.setPositionByOrigin(sceneCenter, 'center', 'center');
      img.setCoords();
      canvas.setActiveObject(img);
      setActiveTool('select');
      canvas.requestRenderAll();
      saveHistory();
    } catch (err) {
      console.error(err);
      alert('Failed to insert library asset: ' + err.message);
    }
  };

  const saveSelectedImageToLibrary = async () => {
    const canvas = fabricCanvas.current;
    const active = canvas?.getActiveObject();
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) {
      alert('Select an image layer first.');
      return;
    }

    setIsLibrarySaving(true);
    try {
      const dataURL = active.toDataURL({ format: 'png' });
      const blob = await (await fetch(dataURL)).blob();
      const fileName = `${(active.name || 'asset').replace(/[^a-z0-9-_]+/gi, '_')}.png`;
      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('source', 'canvas');
      formData.append('name', active.name || 'Canvas Asset');

      const response = await fetch(`${API_BASE_URL}/assets/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save asset');
      }

      const data = await response.json();
      const saved = data.item;
      if (saved) setAssetLibrary((prev) => [saved, ...prev]);
    } catch (err) {
      console.error(err);
      alert('Failed to save library asset: ' + err.message);
    } finally {
      setIsLibrarySaving(false);
    }
  };

  const deleteAssetFromLibrary = async (assetId) => {
    if (!assetId) return;

    setIsDeletingAsset(true);
    try {
      const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete asset');
      }
      setAssetLibrary((prev) => prev.filter((item) => item.id !== assetId));
      setPendingDeleteAsset(null);
    } catch (err) {
      console.error(err);
      alert('Failed to delete library asset: ' + err.message);
    } finally {
      setIsDeletingAsset(false);
    }
  };

  // --- History (Undo/Redo) Logic ---
  const saveHistory = useCallback(() => {
    if (!fabricCanvas.current || isSavingHistory.current) return;
    const json = fabricCanvas.current.toJSON();
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(JSON.stringify(json));
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  }, [history, historyStep]);

  const undo = () => {
    if (historyStep <= 0) return;
    isSavingHistory.current = true;
    const prevStep = historyStep - 1;
    const state = JSON.parse(history[prevStep]);
    fabricCanvas.current.loadFromJSON(state).then(() => {
      fabricCanvas.current.renderAll();
      setHistoryStep(prevStep);
      isSavingHistory.current = false;
    });
  };

  const redo = () => {
    if (historyStep >= history.length - 1) return;
    isSavingHistory.current = true;
    const nextStep = historyStep + 1;
    const state = JSON.parse(history[nextStep]);
    fabricCanvas.current.loadFromJSON(state).then(() => {
      fabricCanvas.current.renderAll();
      setHistoryStep(nextStep);
      isSavingHistory.current = false;
    });
  };

  // --- Canvas Lifecycle ---
  useEffect(() => {
    if (fabricCanvas.current) {
      fabricCanvas.current.dispose();
      fabricCanvas.current = null;
    }

    if (!canvasRef.current || !canvasContainerRef.current) return;

    if (fabric.FabricObject) {
      fabric.FabricObject.prototype.transparentCorners = false;
      fabric.FabricObject.prototype.cornerColor = '#3b82f6';
      fabric.FabricObject.prototype.cornerStyle = 'circle';
      fabric.FabricObject.prototype.cornerSize = 10;
      fabric.FabricObject.prototype.borderColor = '#3b82f6';
      fabric.FabricObject.prototype.borderScaleFactor = 2;
      fabric.FabricObject.prototype.padding = 4;
    }

    const canvas = new fabric.Canvas(canvasRef.current, {
      backgroundColor: 'transparent',
      width: canvasContainerRef.current?.clientWidth || 900,
      height: canvasContainerRef.current?.clientHeight || 650,
      preserveObjectStacking: true,
      stopContextMenu: true,
      skipOffscreen: false,
    });

    fabricCanvas.current = canvas;
    canvas.setViewportTransform([
      1,
      0,
      0,
      1,
      (canvas.width - WORLD_CANVAS_WIDTH) / 2,
      (canvas.height - WORLD_CANVAS_HEIGHT) / 2,
    ]);
    syncArtboardPattern();

    const worldBounds = new fabric.Rect({
      left: 0,
      top: 0,
      width: WORLD_CANVAS_WIDTH,
      height: WORLD_CANVAS_HEIGHT,
      fill: 'rgba(255,255,255,0)',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false,
      id: 'world-bounds',
    });
    canvas.add(worldBounds);
    canvas.sendObjectToBack(worldBounds);

    const stabilizeRasterObject = (obj) => {
      if (!obj) return;
      if (obj.type === 'FabricImage' || obj.type === 'image') {
        obj.set({
          objectCaching: false,
          noScaleCache: true,
        });
        obj.dirty = true;
      }
    };

    // --- Snapping Logic ---
    const SNAP_THRESHOLD = 10;
    canvas.on('object:moving', (e) => {
      const obj = e.target;
      const canvasWidth = WORLD_CANVAS_WIDTH;
      const canvasHeight = WORLD_CANVAS_HEIGHT;
      const objWidth = obj.getBoundingRect().width;
      const objHeight = obj.getBoundingRect().height;

      // Center Snapping
      if (Math.abs(obj.left + objWidth / 2 - canvasWidth / 2) < SNAP_THRESHOLD) {
        obj.set({ left: canvasWidth / 2 - objWidth / 2 });
      }
      if (Math.abs(obj.top + objHeight / 2 - canvasHeight / 2) < SNAP_THRESHOLD) {
        obj.set({ top: canvasHeight / 2 - objHeight / 2 });
      }

      // Edge Snapping
      if (Math.abs(obj.left) < SNAP_THRESHOLD) obj.set({ left: 0 });
      if (Math.abs(obj.left + objWidth - canvasWidth) < SNAP_THRESHOLD) obj.set({ left: canvasWidth - objWidth });
      if (Math.abs(obj.top) < SNAP_THRESHOLD) obj.set({ top: 0 });
      if (Math.abs(obj.top + objHeight - canvasHeight) < SNAP_THRESHOLD) obj.set({ top: canvasHeight - objHeight });
    });

    canvas.on('object:added', (evt) => {
      stabilizeRasterObject(evt?.target);
      if (!isSavingHistory.current) saveHistory();
      syncUI();
    });
    canvas.on('object:removed', () => { if (!isSavingHistory.current) saveHistory(); syncUI(); });
    canvas.on('object:modified', () => { if (!isSavingHistory.current) saveHistory(); syncUI(); });
    canvas.on('object:scaling', syncUI);
    canvas.on('selection:created', syncUI);
    canvas.on('selection:updated', syncUI);
    canvas.on('selection:cleared', syncUI);

    // Zoom & Pan
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoomLevel = canvas.getZoom();
      zoomLevel *= 0.999 ** delta;
      if (zoomLevel > 15) zoomLevel = 15;
      if (zoomLevel < 0.1) zoomLevel = 0.1;
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoomLevel);
      setZoom(zoomLevel);
      syncArtboardPattern();
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    let isPanning = false;
    let isErasing = false;
    let eraserTarget = null;

    const isImageObject = (obj) => obj && (obj.type === 'FabricImage' || obj.type === 'image');
    const hideEraserCursor = () => {
      if (eraserCursorRef.current) eraserCursorRef.current.style.display = 'none';
    };
    const moveEraserCursor = (e) => {
      if (activeToolRef.current !== 'eraser' || !eraserCursorRef.current) return;
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      eraserCursorRef.current.style.left = `${e.clientX - rect.left}px`;
      eraserCursorRef.current.style.top = `${e.clientY - rect.top}px`;
      eraserCursorRef.current.style.display = 'block';
    };

    const ensureEraserBuffer = (target) => {
      if (!target) return null;
      if (target._pixelCanvas) return target._pixelCanvas;
      const element = target.getElement?.();
      if (!element) return null;

      const sourceW = Math.max(1, Math.round(element.naturalWidth || element.videoWidth || element.width || target.width || 1));
      const sourceH = Math.max(1, Math.round(element.naturalHeight || element.videoHeight || element.height || target.height || 1));
      const buffer = document.createElement('canvas');
      buffer.width = sourceW;
      buffer.height = sourceH;
      const ctx = buffer.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(element, 0, 0, sourceW, sourceH);
      target._pixelCanvas = buffer;
      return buffer;
    };

    const eraseAtScenePoint = (target, scenePoint) => {
      if (!isImageObject(target)) return;
      const buffer = ensureEraserBuffer(target);
      if (!buffer || !target.width || !target.height) return;

      const inv = fabric.util.invertTransform(target.calcTransformMatrix());
      const local = fabric.util.transformPoint(scenePoint, inv);
      const offsetX = target.originX === 'center' ? target.width / 2 : (target.originX === 'right' ? target.width : 0);
      const offsetY = target.originY === 'center' ? target.height / 2 : (target.originY === 'bottom' ? target.height : 0);
      const localX = local.x + offsetX;
      const localY = local.y + offsetY;
      if (localX < 0 || localY < 0 || localX > target.width || localY > target.height) return;

      const ratioX = buffer.width / target.width;
      const ratioY = buffer.height / target.height;
      const brushRadiusLocal = (eraserSizeRef.current / (canvas.getZoom() || 1)) / Math.max(Math.abs(target.scaleX || 1), 0.0001);
      const radiusX = Math.max(1, brushRadiusLocal * ratioX);
      const radiusY = Math.max(1, brushRadiusLocal * ratioY);

      const ctx = buffer.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.ellipse(localX * ratioX, localY * ratioY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      target.setElement(buffer);
      target.dirty = true;
      canvas.requestRenderAll();
    };

    const finalizeEraserTarget = (target) => {
      if (!target || !target._pixelCanvas) return;
      const dataURL = target._pixelCanvas.toDataURL('image/png');
      const props = {
        left: target.left,
        top: target.top,
        scaleX: target.scaleX,
        scaleY: target.scaleY,
        angle: target.angle,
        originX: target.originX,
        originY: target.originY,
        flipX: target.flipX,
        flipY: target.flipY,
        opacity: target.opacity,
        id: target.id,
        name: target.name,
      };

      loadFabricImage(dataURL).then((nextImg) => {
        nextImg.set(props);
        nextImg.setCoords();
        isSavingHistory.current = true;
        canvas.remove(target);
        canvas.add(nextImg);
        canvas.setActiveObject(nextImg);
        isSavingHistory.current = false;
        canvas.requestRenderAll();
        syncUI();
        saveHistory();
      }).catch((err) => {
        console.error('Failed to finalize eraser image:', err);
      });
    };

    const handleMouseMove = (opt) => {
      const active = canvas.getActiveObject();
      if (!active || active.id !== 'temp-prompt-box') return;

      const pointer = canvas.getScenePoint(opt.e);
      const originX = active._originX; // Retrieve stashed origin
      const originY = active._originY;

      active.set({
        left: Math.min(pointer.x, originX),
        top: Math.min(pointer.y, originY),
        width: Math.abs(pointer.x - originX),
        height: Math.abs(pointer.y - originY),
        originX: 'left',
        originY: 'top'
      });

      active.setCoords();
      canvas.renderAll();
    };

    const handleMouseUp = (opt) => {
      if (isErasing) {
        isErasing = false;
        const target = eraserTarget;
        eraserTarget = null;
        finalizeEraserTarget(target);
        canvas.selection = activeToolRef.current !== 'eraser';
        canvas.upperCanvasEl.style.cursor = activeToolRef.current === 'eraser'
          ? 'crosshair'
          : (isSpacePanRef.current || activeToolRef.current === 'pan' ? 'grab' : '');
        return;
      }

      if (isPanning) {
        isPanning = false;
        canvas.setViewportTransform(canvas.viewportTransform);
        syncArtboardPattern();
        canvas.upperCanvasEl.style.cursor = isSpacePanRef.current || activeToolRef.current === 'pan' ? 'grab' : '';
      }
      const active = canvas.getActiveObject();
      if (active && active.id === 'temp-prompt-box') {
        const stashedTarget = active._potentialTarget;

        if (active.width < 5 && active.height < 5) {
          // It's a click, not a drag - create a Point mark
          const newMark = { id: Date.now(), x: active.left, y: active.top };
          setMarks(prev => [...prev, newMark]);
          canvas.remove(active);
        } else {
          // It's a box - save as promptBox
          setPromptBox([
            active.left, active.top,
            active.left + active.width, active.top + active.height
          ]);
        }

        // Restore image selection
        if (stashedTarget) {
          canvas.setActiveObject(stashedTarget);
        }

        canvas.selection = true;
        canvas.renderAll();
        syncUI();
      }
      isPanning = false;
      canvas.selection = true;
    };

    const handleMouseDown = (opt) => {
      if (activeToolRef.current === 'eraser') {
        const active = canvas.getActiveObject();
        const pointer = canvas.getScenePoint(opt.e);
        moveEraserCursor(opt.e);
        const hoveredImage = canvas.getObjects()
          .slice()
          .reverse()
          .find((obj) => isImageObject(obj) && obj.containsPoint(pointer));
        const target = isImageObject(active) ? active : hoveredImage;
        if (!target) {
          canvas.upperCanvasEl.style.cursor = 'none';
          return;
        }
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.setActiveObject(target);
        setContextMenu(null);
        canvas.selection = false;
        canvas.upperCanvasEl.style.cursor = 'crosshair';
        isErasing = true;
        eraserTarget = target;
        eraseAtScenePoint(target, pointer);
        return;
      }

      const clickedCanvasObject = opt.target && opt.target.id !== 'world-bounds' && opt.target.id !== 'temp-prompt-box';
      if (
        clickedCanvasObject &&
        opt.button !== 3 &&
        !isSpacePanRef.current &&
        activeToolRef.current !== 'select' &&
        activeToolRef.current !== 'mark' &&
        activeToolRef.current !== 'eraser'
      ) {
        setActiveTool('select');
        canvas.setActiveObject(opt.target);
        canvas.requestRenderAll();
        syncUI();
        setContextMenu(null);
        return;
      }

      if (activeToolRef.current === 'pan' || isSpacePanRef.current) {
        isPanning = true;
        canvas.selection = false;
        canvas.lastPosX = opt.e.clientX;
        canvas.lastPosY = opt.e.clientY;
        canvas.upperCanvasEl.style.cursor = 'grabbing';
      }
      if (activeToolRef.current === 'mark') {
        const pointer = canvas.getScenePoint(opt.e);

        // Find the image under the cursor (or the only image)
        const images = canvas.getObjects().filter(o => o.type === 'FabricImage' || o.type === 'image');
        const hittedImage = opt.target && (opt.target.type === 'FabricImage' || opt.target.type === 'image')
          ? opt.target
          : images.find(img => img.containsPoint(pointer));

        const finalTarget = hittedImage || (images.length === 1 ? images[0] : null);

        if (finalTarget) {
          canvas.setActiveObject(finalTarget);
          // We don't call syncUI yet because we're about to change active object to the rect
        }

        // Remove old box to prevent duplicate IDs/Keys
        const existing = canvas.getObjects().find(o => o.id === 'temp-prompt-box');
        if (existing) canvas.remove(existing);

        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: '#34d399',
          strokeWidth: 2,
          selectable: false,
          id: 'temp-prompt-box',
          originX: 'left',
          originY: 'top'
        });
        canvas.add(rect);
        // Stash the potential target image AND origin point for standard dragging
        rect._potentialTarget = finalTarget;
        rect._originX = pointer.x;
        rect._originY = pointer.y;

        canvas.setActiveObject(rect);
        canvas.selection = false;
        return;
      }
      if (opt.button === 3 && opt.target) {
        canvas.setActiveObject(opt.target);
        setContextMenu({ x: opt.e.clientX, y: opt.e.clientY, target: opt.target });
      } else {
        setContextMenu(null);
      }
    };

    canvas.on('mouse:down', handleMouseDown);

    canvas.on('mouse:move', (opt) => {
      if (isPanning) {
        const e = opt.e;
        const vpt = canvas.viewportTransform;
        vpt[4] += e.clientX - canvas.lastPosX;
        vpt[5] += e.clientY - canvas.lastPosY;
        canvas.requestRenderAll();
        syncArtboardPattern();
        canvas.lastPosX = e.clientX;
        canvas.lastPosY = e.clientY;
      }
      if (activeToolRef.current === 'eraser') {
        moveEraserCursor(opt.e);
      }
      if (isErasing && eraserTarget) {
        const pointer = canvas.getScenePoint(opt.e);
        eraseAtScenePoint(eraserTarget, pointer);
        return;
      }
      handleMouseMove(opt); // Call the new handler
    });

    canvas.on('mouse:up', handleMouseUp); // Call the new handler
    canvas.upperCanvasEl.addEventListener('mouseleave', hideEraserCursor);

    // Keyboard Shortcuts
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        isSpacePanRef.current = true;
        canvas.upperCanvasEl.style.cursor = 'grab';
        e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      const shortcut = SHORTCUT_DEFINITIONS.find((item) => {
        if (!item.key) return false;
        if (item.id === 'toggleShortcuts') {
          return !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '?' || (e.key === '/' && e.shiftKey));
        }
        if (item.ctrl) {
          return (e.ctrlKey || e.metaKey) && !e.altKey && key === item.key;
        }
        return !e.ctrlKey && !e.metaKey && !e.altKey && key === item.key;
      });
      if (shortcut) {
        switch (shortcut.id) {
          case 'select': setActiveTool('select'); break;
          case 'pan': setActiveTool('pan'); break;
          case 'mark': setActiveTool('mark'); break;
          case 'eraser': setActiveTool('eraser'); break;
          case 'rect': addRect(); break;
          case 'circle': addCircle(); break;
          case 'text': addText(); break;
          case 'imageUpload': imageInputRef.current?.click(); break;
          case 'undo': undo(); break;
          case 'redo': redo(); break;
          case 'toggleShortcuts': setShowShortcutsModal((prev) => !prev); break;
          default: break;
        }
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && e.key === 'g') { groupSelected(); e.preventDefault(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'G') { ungroupSelected(); e.preventDefault(); }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (key === 'l') { executeAlign('left'); e.preventDefault(); return; }
        if (key === 'c') { executeAlign('center-h'); e.preventDefault(); return; }
        if (key === 'r') { executeAlign('right'); e.preventDefault(); return; }
        if (key === 't') { executeAlign('top'); e.preventDefault(); return; }
        if (key === 'v') { executeAlign('center-v'); e.preventDefault(); return; }
        if (key === 'b') { executeAlign('bottom'); e.preventDefault(); return; }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = canvas.getActiveObjects();
        activeObjects.forEach(obj => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.renderAll();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space' && isSpacePanRef.current) {
        isSpacePanRef.current = false;
        if (isPanning) {
          isPanning = false;
          canvas.setViewportTransform(canvas.viewportTransform);
          syncArtboardPattern();
          canvas.selection = true;
          canvas.upperCanvasEl.style.cursor = activeToolRef.current === 'pan' ? 'grab' : '';
        } else {
          canvas.upperCanvasEl.style.cursor = activeToolRef.current === 'pan' ? 'grab' : '';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    saveHistory();

    return () => {
      if (fabricCanvas.current) {
        fabricCanvas.current.dispose();
        fabricCanvas.current = null;
      }
      if (alignmentHintTimerRef.current) {
        clearTimeout(alignmentHintTimerRef.current);
      }
      isSpacePanRef.current = false;
      canvas.upperCanvasEl.removeEventListener('mouseleave', hideEraserCursor);
      hideEraserCursor();
      canvas.upperCanvasEl.style.cursor = '';
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Core Methods ---
  const groupSelected = () => {
    const canvas = fabricCanvas.current;
    const activeSelection = canvas.getActiveObject();
    if (!activeSelection || activeSelection.type !== 'activeSelection') return;
    activeSelection.toGroup();
    canvas.requestRenderAll();
    saveHistory();
  };

  const ungroupSelected = () => {
    const canvas = fabricCanvas.current;
    const activeGroup = canvas.getActiveObject();
    if (!activeGroup || activeGroup.type !== 'group') return;
    activeGroup.toActiveSelection();
    canvas.requestRenderAll();
    saveHistory();
  };

  const getSelectedBounds = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return null;

    const activeObjects = canvas.getActiveObjects().filter((obj) => obj.id !== 'world-bounds' && obj.id !== 'temp-prompt-box');
    if (!activeObjects || activeObjects.length === 0) return null;

    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;
    let hasBounds = false;

    for (const obj of activeObjects) {
      const bounds = obj.getBoundingRect(true, true);
      if (!bounds || !isFinite(bounds.left) || !isFinite(bounds.top) || !isFinite(bounds.width) || !isFinite(bounds.height)) {
        continue;
      }
      minLeft = Math.min(minLeft, bounds.left);
      minTop = Math.min(minTop, bounds.top);
      maxRight = Math.max(maxRight, bounds.left + bounds.width);
      maxBottom = Math.max(maxBottom, bounds.top + bounds.height);
      hasBounds = true;
    }

    if (!hasBounds) return null;

    return {
      left: minLeft,
      top: minTop,
      width: Math.max(1, Math.ceil(maxRight - minLeft)),
      height: Math.max(1, Math.ceil(maxBottom - minTop)),
    };
  };

  const exportSelectedArea = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const selectedCount = canvas.getActiveObjects().length;
    if (selectedCount === 0) {
      alert('Select at least one layer to export.');
      return;
    }

    const bounds = getSelectedBounds();
    if (!bounds) {
      alert('Could not determine selection bounds.');
      return;
    }

    const selectedObjects = canvas.getActiveObjects().filter((obj) => obj.id !== 'world-bounds' && obj.id !== 'temp-prompt-box');
    if (!selectedObjects.length) {
      alert('Could not determine selectable objects for export.');
      return;
    }

    const normalizedFormat = exportFormat === 'jpg' ? 'jpeg' : exportFormat;
    const ext = exportFormat === 'jpg' ? 'jpg' : exportFormat;
    const quality = normalizedFormat === 'png' ? 1 : 0.92;
    const activeObject = canvas.getActiveObject();
    let dataURL = null;

    const isActiveSelection = activeObject?.type?.toLowerCase() === 'activeselection';

    if (selectedCount >= 2 && isActiveSelection) {
      try {
        dataURL = activeObject.toDataURL({
          format: normalizedFormat,
          quality,
        });
      } catch (err) {
        alert('Export failed for multiple selected layers. Please reselect and try again.');
        return;
      }
    } else if (activeObject && isActiveSelection) {
      try {
        dataURL = activeObject.toDataURL({
          format: normalizedFormat,
          quality,
        });
      } catch (err) {
        dataURL = null;
      }
    }

    if (!dataURL && activeObject && selectedCount === 1) {
      try {
        dataURL = activeObject.toDataURL({
          format: normalizedFormat,
          quality,
        });
      } catch (err) {
        dataURL = null;
      }
    }

    if (!dataURL) {
      const exportSet = new Set(selectedObjects);
      dataURL = canvas.toDataURL({
        format: normalizedFormat,
        quality,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        filter: (obj) => exportSet.has(obj),
      });
    }

    if (!dataURL) {
      alert('Export failed to generate image data.');
      return;
    }

    const link = document.createElement('a');
    try {
      link.href = dataURL;
      link.download = `selection-export.${ext}`;
      link.click();
    } catch (err) {
      alert('Export failed. Please try again.');
    }

  };

  const canAlignSelection = () => {
    const activeObjects = fabricCanvas.current?.getActiveObjects?.() || [];
    return activeObjects.length >= 2;
  };

  const triggerAlignHint = () => {
    setShowAlignmentHint(true);
    if (alignmentHintTimerRef.current) {
      clearTimeout(alignmentHintTimerRef.current);
    }
    alignmentHintTimerRef.current = setTimeout(() => {
      setShowAlignmentHint(false);
      alignmentHintTimerRef.current = null;
    }, 1800);
  };

  const executeAlign = (type) => {
    if (!canAlignSelection()) {
      triggerAlignHint();
      return;
    }
    if (alignmentHintTimerRef.current) {
      clearTimeout(alignmentHintTimerRef.current);
      alignmentHintTimerRef.current = null;
    }
    setShowAlignmentHint(false);
    align(type);
  };

  const align = (type) => {
    const canvas = fabricCanvas.current;
    const activeObjects = canvas?.getActiveObjects?.() || [];
    if (!canvas || activeObjects.length < 2) {
      triggerAlignHint();
      return;
    }

    let minLeft = Infinity;
    let maxRight = -Infinity;
    let minTop = Infinity;
    let maxBottom = -Infinity;

    const objectBounds = activeObjects.map((obj) => {
      const bound = obj.getBoundingRect();
      const bounds = {
        obj,
        left: bound.left,
        right: bound.left + bound.width,
        top: bound.top,
        bottom: bound.top + bound.height,
      };
      minLeft = Math.min(minLeft, bounds.left);
      maxRight = Math.max(maxRight, bounds.right);
      minTop = Math.min(minTop, bounds.top);
      maxBottom = Math.max(maxBottom, bounds.bottom);
      return bounds;
    });

    const selectionLeft = minLeft;
    const selectionRight = maxRight;
    const selectionTop = minTop;
    const selectionBottom = maxBottom;
    const selectionCenterX = (selectionLeft + selectionRight) / 2;
    const selectionCenterY = (selectionTop + selectionBottom) / 2;

    for (const item of objectBounds) {
      const bound = item.obj.getBoundingRect();
      const offsetX = item.obj.left - bound.left;
      const offsetY = item.obj.top - bound.top;
      switch (type) {
        case 'left':
          item.obj.set('left', selectionLeft + offsetX);
          break;
        case 'center-h':
          item.obj.set('left', selectionCenterX - (bound.width / 2) + offsetX);
          break;
        case 'right':
          item.obj.set('left', selectionRight - bound.width + offsetX);
          break;
        case 'top':
          item.obj.set('top', selectionTop + offsetY);
          break;
        case 'center-v':
          item.obj.set('top', selectionCenterY - (bound.height / 2) + offsetY);
          break;
        case 'bottom':
          item.obj.set('top', selectionBottom - bound.height + offsetY);
          break;
      }
    }
    activeObjects.forEach((obj) => obj.setCoords());
    canvas.renderAll();
    saveHistory();
  };

  const resetZoom = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const baseTransform = [
      1,
      0,
      0,
      1,
      (canvas.width - WORLD_CANVAS_WIDTH) / 2,
      (canvas.height - WORLD_CANVAS_HEIGHT) / 2,
    ];

    canvas.setViewportTransform(baseTransform);
    setZoom(1);
    canvas.requestRenderAll();
    syncArtboardPattern();
  };

  const fitCanvas = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const viewportWidth = canvas.width || 1;
    const viewportHeight = canvas.height || 1;
    const scaleX = viewportWidth / WORLD_CANVAS_WIDTH;
    const scaleY = viewportHeight / WORLD_CANVAS_HEIGHT;
    const fitScale = Math.max(0.05, Math.min(1, Math.min(scaleX, scaleY)));
    const panX = (viewportWidth - WORLD_CANVAS_WIDTH * fitScale) / 2;
    const panY = (viewportHeight - WORLD_CANVAS_HEIGHT * fitScale) / 2;

    canvas.setViewportTransform([fitScale, 0, 0, fitScale, panX, panY]);
    setZoom(fitScale);
    canvas.requestRenderAll();
    syncArtboardPattern();
  };

  const fitSelection = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) {
      fitCanvas();
      return;
    }

    const viewportWidth = canvas.width || 1;
    const viewportHeight = canvas.height || 1;
    const bounds = canvas.getActiveObject()?.getBoundingRect(true);
    if (!bounds) {
      fitCanvas();
      return;
    }

    const margin = 64;
    const paddingX = 0;
    const paddingY = 0;
    const effectiveTargetW = Math.max(1, viewportWidth - margin * 2 - paddingX);
    const effectiveTargetH = Math.max(1, viewportHeight - margin * 2 - paddingY);
    const scaleX = effectiveTargetW / Math.max(1, bounds.width);
    const scaleY = effectiveTargetH / Math.max(1, bounds.height);
    const fitScale = Math.max(0.05, Math.min(15, Math.min(scaleX, scaleY)));

    const panX = margin - bounds.left * fitScale;
    const panY = margin - bounds.top * fitScale;

    canvas.setViewportTransform([fitScale, 0, 0, fitScale, panX, panY]);
    setZoom(fitScale);
    canvas.requestRenderAll();
    syncArtboardPattern();
  };

  const addRect = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const rect = new fabric.Rect({
      width: 150, height: 150, rx: 12, ry: 12,
      fill: 'rgba(59, 130, 246, 0.5)', stroke: '#3b82f6', strokeWidth: 2
    });
    canvas.add(rect);
    const sceneCenter = getCreationCenterInScene();
    rect.setPositionByOrigin(sceneCenter, 'center', 'center');
    rect.setCoords();
    canvas.setActiveObject(rect);
    canvas.requestRenderAll();
    syncUI();
    saveHistory();
  };

  const addCircle = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const circle = new fabric.Circle({
      radius: 75,
      fill: 'rgba(59, 130, 246, 0.5)',
      stroke: '#3b82f6',
      strokeWidth: 2
    });
    canvas.add(circle);
    const sceneCenter = getCreationCenterInScene();
    circle.setPositionByOrigin(sceneCenter, 'center', 'center');
    circle.setCoords();
    canvas.setActiveObject(circle);
    canvas.requestRenderAll();
    syncUI();
    saveHistory();
  };

  const addText = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const text = new fabric.IText('New Text Layer', {
      fontFamily: 'Inter', fontSize: 32, fill: '#18181b'
    });
    canvas.add(text);
    const sceneCenter = getCreationCenterInScene();
    text.setPositionByOrigin(sceneCenter, 'center', 'center');
    text.setCoords();
    canvas.setActiveObject(text);
    canvas.requestRenderAll();
    syncUI();
    saveHistory();
  };

  const addImage = (file, dropPoint = null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (f) => {
      try {
        const canvas = fabricCanvas.current;
        if (!canvas) return;
        const img = await loadFabricImage(f.target.result);
        img.scaleToWidth(400);
        img.name = file.name;
        canvas.add(img);

        if (dropPoint) {
          const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
          const zoomX = vpt[0] || 1;
          const zoomY = vpt[3] || zoomX;
          const sceneX = (dropPoint.x - vpt[4]) / zoomX;
          const sceneY = (dropPoint.y - vpt[5]) / zoomY;
          img.setPositionByOrigin(new fabric.Point(sceneX, sceneY), 'center', 'center');
          img.setCoords();
        } else {
          const sceneCenter = getCreationCenterInScene();
          img.setPositionByOrigin(sceneCenter, 'center', 'center');
          img.setCoords();
        }

        canvas.setActiveObject(img);
        setActiveTool('select');
        canvas.requestRenderAll();
        saveHistory();
      } catch (err) {
        console.error("Failed to load image:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  const setProperty = (prop, value) => {
    const canvas = fabricCanvas.current;
    const active = canvas.getActiveObject();
    if (!active) return;

    if (prop === 'fontSize') {
      active.set({ fontSize: value, scaleX: 1, scaleY: 1 });
    } else {
      active.set(prop, value);
    }

    if (active.setCoords) active.setCoords();
    canvas.renderAll();
    syncUI();
    saveHistory();
  };

  const ensureHex = (color) => {
    if (!color || typeof color !== 'string' || !color.startsWith('#')) return '#6366f1';
    return color;
  };

  const removeBackground = async () => {
    const canvas = fabricCanvas.current;
    const active = canvas.getActiveObject();
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) return;

    setIsAiProcessing(true);
    try {
      // Save current state to prevent double transformation
      const originalAngle = active.angle;
      const originalScaleX = active.scaleX;
      const originalScaleY = active.scaleY;

      // Temporarily reset transformation for clean export at native resolution
      active.set({ angle: 0, scaleX: 1, scaleY: 1 });
      const dataURL = active.toDataURL({ format: 'png' });
      // Restore immediately
      active.set({ angle: originalAngle, scaleX: originalScaleX, scaleY: originalScaleY });

      const blob = await (await fetch(dataURL)).blob();

      const formData = new FormData();
      formData.append('file', blob, 'image.png');

      const response = await fetch(`${API_BASE_URL}/remove-bg`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to remove background');

      const resultBlob = await response.blob();
      const resultURL = URL.createObjectURL(resultBlob);

      const img = await loadFabricImage(resultURL);
      img.set({
        left: active.left,
        top: active.top,
        scaleX: active.scaleX,
        scaleY: active.scaleY,
        angle: active.angle,
        id: active.id,
        name: active.name + ' (No BG)'
      });

      canvas.remove(active);
      canvas.add(img);
      canvas.setActiveObject(img);
      syncUI();
      saveHistory();
      setShowRemoveBgConfirm(false); // Close modal on success
    } catch (err) {
      console.error(err);
      alert('AI Processing Error: ' + err.message);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const generateAiImage = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiProcessing(true);
    try {
      const formData = new FormData();
      formData.append('prompt', aiPrompt);

      const response = await fetch(`${API_BASE_URL}/generate-image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Generation failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const img = await loadFabricImage(url);
      img.scaleToWidth(512);
      const canvas = fabricCanvas.current;
      canvas.add(img);
      const sceneCenter = getCreationCenterInScene();
      img.setPositionByOrigin(sceneCenter, 'center', 'center');
      img.setCoords();

      canvas.setActiveObject(img);
      canvas.requestRenderAll();

      syncUI();
      saveHistory();
      setShowAiInput(false);
      setAiPrompt('');
    } catch (err) {
      console.error(err);
      alert('AI Generation Error: ' + err.message);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const segmentObject = async () => {
    const canvas = fabricCanvas.current;
    let active = canvas.getActiveObject();

    // If no image is selected, try to find an image that contains the marks
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) {
      const images = canvas.getObjects().filter(o => o.type === 'FabricImage' || o.type === 'image');

      // Try to find an image that overlaps with the marks
      let targetImage = null;
      if (marks.length > 0) {
        const firstMark = new fabric.Point(marks[0].x, marks[0].y);
        targetImage = images.find(img => img.containsPoint(firstMark));
      } else if (promptBox) {
        const boxCenter = new fabric.Point((promptBox[0] + promptBox[2]) / 2, (promptBox[1] + promptBox[3]) / 2);
        targetImage = images.find(img => img.containsPoint(boxCenter));
      }

      if (targetImage) {
        active = targetImage;
        canvas.setActiveObject(active);
        canvas.renderAll();
        syncUI();
      } else if (images.length === 1) {
        active = images[0];
        canvas.setActiveObject(active);
        canvas.renderAll();
        syncUI();
      } else if (images.length > 1) {
        alert("Please select the image you want to segment.");
        return;
      } else {
        alert("Please add an image layer first.");
        return;
      }
    }

    // Capture the target and open modal
    setSegmentTarget(active);
    setShowSegmentModal(true);
  };

  const executeSegment = async (textPrompt) => {
    const canvas = fabricCanvas.current;
    const active = segmentTarget; // Use the captured target
    if (!active) return;

    setShowSegmentModal(false);
    setIsAiProcessing(true);
    try {
      // 1. Save original transformation
      const originalAngle = active.angle;
      const originalScaleX = active.scaleX;
      const originalScaleY = active.scaleY;

      // 2. Map coordinates
      const points = marks.map(m => {
        const point = new fabric.Point(m.x, m.y);
        const matrix = active.calcTransformMatrix();
        const invertedMatrix = fabric.util.invertTransform(matrix);
        const localPt = fabric.util.transformPoint(point, invertedMatrix);
        const x = active.originX === 'left' ? localPt.x : localPt.x + active.width / 2;
        const y = active.originY === 'top' ? localPt.y : localPt.y + active.height / 2;
        return [Math.round(x), Math.round(y)];
      });

      let bboxes = [];
      if (promptBox) {
        const matrix = active.calcTransformMatrix();
        const invertedMatrix = fabric.util.invertTransform(matrix);

        const p1 = fabric.util.transformPoint(new fabric.Point(promptBox[0], promptBox[1]), invertedMatrix);
        const p2 = fabric.util.transformPoint(new fabric.Point(promptBox[2], promptBox[3]), invertedMatrix);

        const offsetX = active.originX === 'left' ? 0 : active.width / 2;
        const offsetY = active.originY === 'top' ? 0 : active.height / 2;

        bboxes = [[
          Math.round(Math.min(p1.x, p2.x) + offsetX),
          Math.round(Math.min(p1.y, p2.y) + offsetY),
          Math.round(Math.max(p1.x, p2.x) + offsetX),
          Math.round(Math.max(p1.y, p2.y) + offsetY)
        ]];
      }

      console.log('===== [SAM 3 Debug] =====');
      console.log('Points:', points);
      console.log('Boxes:', bboxes);

      // 3. Export clean image (no scale/angle)
      active.set({ angle: 0, scaleX: 1, scaleY: 1 });
      const dataURL = active.toDataURL({ format: 'png' });

      // 4. Restore transforms immediately
      active.set({ angle: originalAngle, scaleX: originalScaleX, scaleY: originalScaleY });

      const blob = await (await fetch(dataURL)).blob();
      const formData = new FormData();
      formData.append('file', blob, 'image.png');
      formData.append('points', JSON.stringify(points));
      formData.append('labels', JSON.stringify(points.map(() => 1)));
      formData.append('bboxes', JSON.stringify(bboxes));
      if (textPrompt) formData.append('text', textPrompt);

      const response = await fetch(`${API_BASE_URL}/segment`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Segmentation failed' }));
        throw new Error(errorData.detail || 'Segmentation failed');
      }

      const resultBlob = await response.blob();
      const resultURL = URL.createObjectURL(resultBlob);

      const img = await loadFabricImage(resultURL);
      img.set({
        left: active.left,
        top: active.top,
        scaleX: active.scaleX,
        scaleY: active.scaleY,
        angle: active.angle,
        name: active.name + ' (Segment)'
      });

      canvas.add(img);
      canvas.setActiveObject(img);

      setMarks([]);
      syncUI();
      saveHistory();
    } catch (err) {
      console.error(err);
      alert('AI Segmentation Error: ' + err.message);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const convertToText = async () => {
    const canvas = fabricCanvas.current;
    const active = canvas.getActiveObject();
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) {
      alert("Please select a segmented image layer (the text image) first.");
      return;
    }

    setIsAiProcessing(true);
    try {
      // 1. Export the current image
      const dataURL = active.toDataURL({ format: 'png' });
      const blob = await (await fetch(dataURL)).blob();

      const formData = new FormData();
      formData.append('file', blob, 'text_region.png');

      // 2. Extract text information from backend
      const response = await fetch(`${API_BASE_URL}/extract-text`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Text recognition failed');

      const data = await response.json();
      if (!data.content || data.content.trim() === "") {
        alert("AI could not recognize any text in this image.");
        return;
      }

      // 3. Create a new IText object
      const textObj = new fabric.IText(data.content, {
        left: active.left,
        top: active.top,
        fontSize: (active.height * active.scaleY) * 0.8, // Approximate size
        fill: data.color || '#000000',
        fontWeight: data.isBold ? 'bold' : 'normal',
        fontFamily: 'Inter',
        angle: active.angle,
        scaleX: active.scaleX,
        scaleY: active.scaleY,
        originX: active.originX,
        originY: active.originY,
        name: `${active.name || 'Layer'} (OCR Text)`
      });

      // 4. Keep original image visible and add text overlay
      canvas.add(textObj);
      canvas.setActiveObject(textObj);

      syncUI();
      saveHistory();
    } catch (err) {
      console.error(err);
      alert('Text Conversion Error: ' + err.message);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const applyImageFilter = (type, val) => {
    const obj = fabricCanvas.current.getActiveObject();
    if (!obj || obj.type !== 'FabricImage') return;

    if (type === 'grayscale') {
      if (val) obj.filters.push(new fabric.filters.Grayscale());
      else obj.filters = obj.filters.filter(f => f.type !== 'Grayscale');
    } else if (type === 'brightness') {
      const f = obj.filters.find(f => f.type === 'Brightness');
      if (f) f.brightness = val;
      else obj.filters.push(new fabric.filters.Brightness({ brightness: val }));
    }
    obj.applyFilters();
    fabricCanvas.current.renderAll();
    syncUI();
    saveHistory();
  };

  const clearMarks = () => {
    setMarks([]);
    setPromptBox(null);
    if (fabricCanvas.current) {
      const box = fabricCanvas.current.getObjects().find(o => o.id === 'temp-prompt-box');
      if (box) fabricCanvas.current.remove(box);
      fabricCanvas.current.renderAll();
    }
  };

  const removeMark = (id) => {
    setMarks(prev => prev.filter(m => m.id !== id));
  };

  // --- Layer Management ---
  const reorderLayer = (targetObj, direction) => {
    const canvas = fabricCanvas.current;
    if (!targetObj || !canvas) return;

    if (direction === 'up') {
      canvas.bringObjectForward(targetObj);
    } else {
      canvas.sendObjectBackwards(targetObj);
    }

    canvas.requestRenderAll();
    syncUI();
    saveHistory();
  };

  const moveLayerByDrag = (sourceIdx, targetIdx) => {
    const canvas = fabricCanvas.current;
    if (!canvas || sourceIdx === targetIdx) return;

    const sourceObj = layers[sourceIdx].object;
    // layers[0] is top of stack (last in canvas array)
    const newCanvasIndex = canvas.getObjects().length - 1 - targetIdx;

    canvas.moveObjectTo(sourceObj, newCanvasIndex);
    canvas.requestRenderAll();
    syncUI();
    saveHistory();
  };

  const renameLayer = (id, newName) => {
    const canvas = fabricCanvas.current;
    const target = canvas.getObjects().find(o => o.id === id);
    if (target) {
      target.name = newName;
      canvas.requestRenderAll();
      syncUI();
      saveHistory();
    }
    setRenamingId(null);
  };

  const selectedIsText = selectedObject?.type === 'i-text' || selectedObject?.type === 'text';
  const selectedIsShape = selectedObject?.type === 'rect' || selectedObject?.type === 'circle' || selectedObject?.type === 'ellipse';
  const selectedIsImage = selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image';

  // --- HTML Sub-components ---
  const Sidebar = () => (
    <aside className="sidebar">
      <div className="sidebar-logo"><Sparkles size={28} color="var(--accent)" /></div>
      <button className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`} onClick={() => setActiveTool('pan')} title="Hand (H / Space)"><Hand size={22} /></button>
      <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')} title="Selection (V)"><MousePointer2 size={22} /></button>
      <button className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`} onClick={() => setActiveTool('eraser')} title="Pixel Eraser (E)"><Eraser size={20} /></button>
      <button className={`tool-btn ${activeTool === 'mark' ? 'active' : ''}`} onClick={() => setActiveTool('mark')} title="Mark (M)"><Target size={22} /></button>
      <div className="sidebar-divider" />
      <button className="tool-btn" onClick={addRect} title="Rectangle (R)"><Square size={22} /></button>
      <button className="tool-btn" onClick={addCircle} title="Circle (O)"><Circle size={20} /></button>
      <button className="tool-btn" onClick={addText} title="Text (T)"><TypeIcon size={22} /></button>
      <label className="tool-btn" title="Image (I)"><ImageIcon size={22} /><input ref={imageInputRef} type="file" hidden accept="image/*" onChange={(e) => addImage(e.target.files[0])} /></label>
    </aside>
  );

  const Topbar = () => (
    <header className="topbar">
      <div className="topbar-left">
        <h2 className="brand-title">OPEN LOVART</h2>
        <div className="history-group">
          <button className="icon-btn" onClick={undo} disabled={historyStep <= 0}><Undo2 size={16} /></button>
          <button className="icon-btn" onClick={redo} disabled={historyStep >= history.length - 1}><Redo2 size={16} /></button>
        </div>
      </div>
      <div className="topbar-actions">
        <button className={`action-tag ${showAiInput ? 'active' : ''}`} onClick={() => setShowAiInput(!showAiInput)}>
          <Sparkles size={14} /> Magic Generate
        </button>
      </div>
      <div className="topbar-right">
        <button className="action-tag" onClick={() => setShowGrid(!showGrid)}><Grid size={14} /> Grid</button>
        <button className="action-tag" onClick={() => setShowSettingsModal(true)}><Settings size={14} /> Settings</button>
        <select
          className="export-format-select"
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value)}
        >
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
          <option value="webp">WEBP</option>
        </select>
        <button className="primary-btn" onClick={exportSelectedArea}>
          <Download size={16} /> Export
        </button>
      </div>
    </header>
  );

  const canAlignNow = canAlignSelection();

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      <Sidebar />
      <Topbar />

      {/* Main Artboard */}
      <main
        ref={canvasContainerRef}
        className={`artboard ${!showGrid ? 'no-grid' : ''} ${isDragging ? 'dragging' : ''} ${activeTool === 'pan' ? 'pan-tool' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragCounter.current++;
          if (e.dataTransfer.types.includes('Files')) {
            setIsDragging(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragCounter.current--;
          if (dragCounter.current === 0) {
            setIsDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          dragCounter.current = 0;

          const files = e.dataTransfer.files;
          console.log('Files dropped:', files.length);
          if (files && files.length > 0) {
            const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
            if (imageFiles.length === 0) return;

            const canvasRect = fabricCanvas.current?.upperCanvasEl?.getBoundingClientRect();
            const dropPoint = canvasRect
              ? { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top }
              : null;

            if (!dropPoint || imageFiles.length === 1) {
              imageFiles.forEach((file) => addImage(file, dropPoint));
              return;
            }

            const cols = Math.ceil(Math.sqrt(imageFiles.length));
            const rows = Math.ceil(imageFiles.length / cols);
            const spacing = 64;

            imageFiles.forEach((file, idx) => {
              const col = idx % cols;
              const row = Math.floor(idx / cols);
              const offsetX = (col - (cols - 1) / 2) * spacing;
              const offsetY = (row - (rows - 1) / 2) * spacing;
              addImage(file, {
                x: dropPoint.x + offsetX,
                y: dropPoint.y + offsetY,
              });
            });
          }
        }}>
        <div className="canvas-shadow">
          <canvas ref={canvasRef} />
          <div
            ref={eraserCursorRef}
            className="eraser-cursor"
            style={{
              width: `${eraserSize * 2}px`,
              height: `${eraserSize * 2}px`,
              display: activeTool === 'eraser' ? 'block' : 'none'
            }}
          />
          {marks.map((m, i) => (
            <div
              key={m.id}
              className="mark-badge-canvas"
              title="Click to remove"
              onClick={(e) => { e.stopPropagation(); removeMark(m.id); }}
              style={{
                left: (m.x * fabricCanvas.current.getZoom()) + fabricCanvas.current.viewportTransform[4],
                top: (m.y * fabricCanvas.current.getZoom()) + fabricCanvas.current.viewportTransform[5]
              }}>{i + 1}</div>
          ))}
        </div>
        {isDragging && <div className="drop-overlay">Drop images to upload</div>}

        {/* Floating Quick AI */}
        {(marks.length > 0 || promptBox) && (
          <div className="quick-ai-panel">
            <div className="ai-counts">
              {marks.length > 0 && <span>{marks.length} Points</span>}
              {promptBox && <span>Area Selected</span>}
            </div>
            <div className="v-div" />
            <button className="ai-action" onClick={segmentObject}>Segment</button>
            <button className="ai-action secondary" onClick={clearMarks}>Clear All</button>
          </div>
        )}
      </main>

      {showAiInput && (
        <div className="ai-prompt-overlay">
          <div className="ai-prompt-container">
            <Sparkles size={20} className="ai-accent-icon" />
            <input
              autoFocus
              className="ai-prompt-input"
              placeholder="Describe the image you want to create..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && generateAiImage()}
            />
            <button className="ai-gen-btn" onClick={generateAiImage} disabled={isAiProcessing}>
              {isAiProcessing ? 'Generating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <aside className="control-panel">
        <div className="panel-tabs">
          <button className={`panel-tab ${activePanelTab === 'properties' ? 'active' : ''}`} onClick={() => setActivePanelTab('properties')}>Properties</button>
          <button className={`panel-tab ${activePanelTab === 'library' ? 'active' : ''}`} onClick={() => setActivePanelTab('library')}>Library</button>
          <button className={`panel-tab ${activePanelTab === 'layers' ? 'active' : ''}`} onClick={() => setActivePanelTab('layers')}>Layers</button>
        </div>

        {activePanelTab === 'properties' && (
          <>
            <div className="cp-section">
              <h3 className="section-label">Alignment</h3>
              <div className="align-grid">
                <button
                  disabled={!canAlignNow}
                  title={!canAlignNow ? 'Select at least 2 layers to align' : 'Align left'}
                  onClick={() => executeAlign('left')}
                >
                  <AlignLeft size={18} />
                </button>
                <button
                  disabled={!canAlignNow}
                  title={!canAlignNow ? 'Select at least 2 layers to align' : 'Align center'}
                  onClick={() => executeAlign('center-h')}
                >
                  <AlignCenter size={18} />
                </button>
                <button
                  disabled={!canAlignNow}
                  title={!canAlignNow ? 'Select at least 2 layers to align' : 'Align right'}
                  onClick={() => executeAlign('right')}
                >
                  <AlignRight size={18} />
                </button>
                <button
                  disabled={!canAlignNow}
                  title={!canAlignNow ? 'Select at least 2 layers to align' : 'Align top'}
                  onClick={() => executeAlign('top')}
                >
                  <AlignVerticalJustifyStart size={18} />
                </button>
                <button
                  disabled={!canAlignNow}
                  title={!canAlignNow ? 'Select at least 2 layers to align' : 'Align center vertical'}
                  onClick={() => executeAlign('center-v')}
                >
                  <AlignVerticalJustifyCenter size={18} />
                </button>
                <button
                  disabled={!canAlignNow}
                  title={!canAlignNow ? 'Select at least 2 layers to align' : 'Align bottom'}
                  onClick={() => executeAlign('bottom')}
                >
                  <AlignVerticalJustifyEnd size={18} />
                </button>
              </div>
              {showAlignmentHint && (
                <p className="align-hint">Select at least 2 layers to use alignment.</p>
              )}
            </div>

            <div className="cp-section">
              <h3 className="section-label">Properties</h3>
              {selectedObject ? (
                <div className="props-body">
                  <div className="props-subtabs">
                    <button className={`props-subtab ${activePropsTab === 'text' ? 'active' : ''}`} onClick={() => setActivePropsTab('text')}>Text</button>
                    <button className={`props-subtab ${activePropsTab === 'image' ? 'active' : ''}`} onClick={() => setActivePropsTab('image')}>Image</button>
                    <button className={`props-subtab ${activePropsTab === 'shape' ? 'active' : ''}`} onClick={() => setActivePropsTab('shape')}>Shape</button>
                  </div>
                  <div className="prop-input-group">
                    <label>Opacity</label>
                    <input type="range" min="0" max="1" step="0.01" value={selectedObject.opacity} onChange={(e) => setProperty('opacity', parseFloat(e.target.value))} />
                  </div>

                  {activePropsTab === 'text' && selectedIsText && (
                    <div className="text-tools">
                      <div className="prop-input-group">
                        <label>Font</label>
                        <select value={selectedObject.fontFamily} onChange={(e) => setProperty('fontFamily', e.target.value)}>
                          <option value="Inter">Inter (Sans)</option>
                          <option value="Roboto">Roboto</option>
                          <option value="Georgia">Georgia (Serif)</option>
                          <option value="Montserrat">Montserrat</option>
                          <option value="Playfair Display">Playfair Display</option>
                          <option value="Courier New">Monospace</option>
                        </select>
                      </div>
                      <div className="prop-input-group">
                        <label>Font Size</label>
                        <div className="modern-input-group">
                          <button className="input-step-btn" onClick={() => setProperty('fontSize', Math.max(1, selectedObject.fontSize - 1))}>-</button>
                          <input type="number" value={Math.round(selectedObject.fontSize)} onChange={(e) => setProperty('fontSize', parseInt(e.target.value) || 1)} />
                          <button className="input-step-btn" onClick={() => setProperty('fontSize', selectedObject.fontSize + 1)}>+</button>
                        </div>
                      </div>
                      <div className="prop-input-group">
                        <label>Text Color</label>
                        <input type="color" value={ensureHex(selectedObject.fill)} onChange={(e) => setProperty('fill', e.target.value)} />
                      </div>
                      <div className="flex-row">
                        <button className={`toggle-btn ${selectedObject.fontWeight === 'bold' ? 'active' : ''}`} onClick={() => setProperty('fontWeight', selectedObject.fontWeight === 'bold' ? 'normal' : 'bold')}><Bold size={16} /></button>
                        <button className={`toggle-btn ${selectedObject.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => setProperty('fontStyle', selectedObject.fontStyle === 'italic' ? 'normal' : 'italic')}><Italic size={16} /></button>
                      </div>
                    </div>
                  )}
                  {activePropsTab === 'text' && !selectedIsText && (
                    <div className="no-selection-msg">Select a text layer for Text controls</div>
                  )}

                  {activePropsTab === 'shape' && selectedIsShape && (
                    <div className="shape-tools">
                      <div className="prop-input-group">
                        <label>Fill Color</label>
                        <input type="color" value={ensureHex(selectedObject.fill)} onChange={(e) => setProperty('fill', e.target.value)} />
                      </div>
                    </div>
                  )}
                  {activePropsTab === 'shape' && !selectedIsShape && (
                    <div className="no-selection-msg">Select a shape layer for Shape controls</div>
                  )}

                  {activePropsTab === 'image' && selectedIsImage && (
                    <div className="image-tools">
                      <div className="props-action-list">
                        <button
                          className="action-tag"
                          onClick={() => setShowRemoveBgConfirm(true)}
                          disabled={isAiProcessing}
                        >
                          <Sparkles size={14} /> {isAiProcessing ? 'Removing...' : 'Remove Bg'}
                        </button>
                        <button
                          className="action-tag"
                          onClick={segmentObject}
                          disabled={isAiProcessing}
                        >
                          <Scissors size={14} /> {isAiProcessing ? 'Segmenting...' : 'Segment'}
                        </button>
                        <button
                          className="action-tag"
                          onClick={convertToText}
                          disabled={isAiProcessing}
                        >
                          <TypeIcon size={14} /> {isAiProcessing ? 'Converting...' : 'To Text'}
                        </button>
                        <button className="action-tag" onClick={groupSelected}><Group size={14} /> Group</button>
                        <button className="action-tag" onClick={ungroupSelected}><Ungroup size={14} /> Ungroup</button>
                      </div>
                      {activeTool === 'eraser' && (
                        <div className="prop-input-group">
                          <label>Eraser Size ({eraserSize}px)</label>
                          <input
                            type="range"
                            min="6"
                            max="140"
                            step="1"
                            value={eraserSize}
                            onChange={(e) => setEraserSize(parseInt(e.target.value, 10) || 28)}
                          />
                        </div>
                      )}
                      <div className="prop-input-group">
                        <label>Brightness</label>
                        <input type="range" min="-1" max="1" step="0.1" value={selectedObject.brightness} onChange={(e) => applyImageFilter('brightness', parseFloat(e.target.value))} />
                      </div>
                      <div className="check-row">
                        <input type="checkbox" checked={selectedObject.grayscale} onChange={(e) => applyImageFilter('grayscale', e.target.checked)} />
                        <span>Grayscale</span>
                      </div>
                    </div>
                  )}
                  {activePropsTab === 'image' && !selectedIsImage && (
                    <div className="no-selection-msg">Select an image layer for Image controls</div>
                  )}
                </div>
              ) : <div className="no-selection-msg">Select an object</div>}
            </div>
          </>
        )}

        {activePanelTab === 'library' && (
          <div className="cp-section">
            <h3 className="section-label">Library</h3>
            <div className="library-actions">
              <button
                className="library-save-btn"
                onClick={saveSelectedImageToLibrary}
                disabled={isLibrarySaving || !(selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image')}
              >
                {isLibrarySaving ? 'Saving...' : 'Save Selected Image'}
              </button>
            </div>
            {isLibraryLoading ? (
              <div className="no-selection-msg">Loading library...</div>
            ) : assetLibrary.length === 0 ? (
              <div className="no-selection-msg">No saved assets yet</div>
            ) : (
              <div className="library-grid">
                {assetLibrary.map((asset) => (
                  <div
                    key={asset.id}
                    className="library-card"
                  >
                    <button
                      className="library-insert-btn"
                      onClick={() => addImageFromAsset(asset)}
                      title={asset.name || 'Asset'}
                    >
                      <img src={toAbsoluteAssetUrl(asset.url)} alt={asset.name || 'Asset'} loading="lazy" />
                      <span>{asset.name || 'Untitled'}</span>
                    </button>
                    <button
                      className="library-delete-btn"
                      title="Delete asset"
                      onClick={() => setPendingDeleteAsset(asset)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activePanelTab === 'layers' && (
          <div className="cp-section layers-section">
            <h3 className="section-label">Layers</h3>
            <div className="layers-list-modern">
              {layers.map((l, idx) => (
                <div
                  key={l.id}
                  className={`layer-row ${l.active ? 'active' : ''} ${draggedLayerIndex === idx ? 'dragging' : ''} ${dragOverIndex === idx ? 'drag-over' : ''}`}
                  draggable
                  onDragStart={() => setDraggedLayerIndex(idx)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
                  onDragEnd={() => { setDraggedLayerIndex(null); setDragOverIndex(null); }}
                  onDrop={(e) => { e.preventDefault(); moveLayerByDrag(draggedLayerIndex, idx); setDragOverIndex(null); }}
                  onClick={() => { fabricCanvas.current.setActiveObject(l.object); fabricCanvas.current.requestRenderAll(); }}
                >
                  <div className="l-order-btns">
                    <button onClick={(e) => { e.stopPropagation(); reorderLayer(l.object, 'up'); }}><ChevronUp size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); reorderLayer(l.object, 'down'); }}><ChevronDown size={12} /></button>
                  </div>
                  {renamingId === l.id ? (
                    <input autoFocus onBlur={(e) => renameLayer(l.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && renameLayer(l.id, e.target.value)} defaultValue={l.name} className="rename-input" />
                  ) : (
                    <span onDoubleClick={() => setRenamingId(l.id)} className="l-name">{l.name}</span>
                  )}
                  <div className="l-actions">
                    <button onClick={(e) => { e.stopPropagation(); l.object.visible = !l.object.visible; fabricCanvas.current.requestRenderAll(); syncUI(); }}>{l.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                    <button onClick={(e) => { e.stopPropagation(); fabricCanvas.current.remove(l.object); }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => !isSettingsSaving && setShowSettingsModal(false)}>
          <div className="confirm-modal" style={{ maxWidth: 560, alignItems: 'stretch' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-text" style={{ textAlign: 'left' }}>
              <h3>Server Settings</h3>
              <p>Generate workflow, OCR model, vision model, and server URLs.</p>
            </div>

            {isSettingsLoading ? (
              <div className="no-selection-msg">Loading settings...</div>
            ) : (
              <div className="props-body">
                <div className="prop-input-group">
                  <label>ComfyUI URL</label>
                  <input
                    type="text"
                    value={settingsDraft.comfyui}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, comfyui: e.target.value }))}
                    disabled={isSettingsSaving}
                  />
                </div>
                <div className="prop-input-group">
                  <label>Ollama URL</label>
                  <input
                    type="text"
                    value={settingsDraft.ollama}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, ollama: e.target.value }))}
                    disabled={isSettingsSaving}
                  />
                </div>
                <div className="prop-input-group">
                  <label>Generate Workflow</label>
                  <select
                    value={settingsDraft.workflow}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, workflow: e.target.value }))}
                    disabled={isSettingsSaving}
                  >
                    {settingsOptions.workflows.map((wf) => (
                      <option key={wf} value={wf}>{wf}</option>
                    ))}
                  </select>
                </div>
                <div className="prop-input-group">
                  <label>OCR Model</label>
                  <select
                    value={settingsDraft.ocrModel}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, ocrModel: e.target.value }))}
                    disabled={isSettingsSaving}
                  >
                    {settingsOptions.ocrModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
                <div className="prop-input-group">
                  <label>Vision Model</label>
                  <select
                    value={settingsDraft.visionModel}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, visionModel: e.target.value }))}
                    disabled={isSettingsSaving}
                  >
                    {settingsOptions.visionModels.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setShowSettingsModal(false)}
                disabled={isSettingsSaving}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={saveServerSettings}
                disabled={isSettingsSaving || isSettingsLoading}
              >
                {isSettingsSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteAsset && (
        <div className="modal-overlay" onClick={() => !isDeletingAsset && setPendingDeleteAsset(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon-circle danger">
              <Trash2 size={28} />
            </div>
            <div className="modal-text">
              <h3>Delete Library Asset?</h3>
              <p>
                This will remove <strong className="asset-name-break">{pendingDeleteAsset.name || 'this asset'}</strong> from your library.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setPendingDeleteAsset(null)}
                disabled={isDeletingAsset}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm danger"
                onClick={() => deleteAssetFromLibrary(pendingDeleteAsset.id)}
                disabled={isDeletingAsset}
              >
                {isDeletingAsset ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Popup */}
      {
        contextMenu && (
          <div className="floating-context" style={{ top: contextMenu.y, left: contextMenu.x }}>
            <div className="context-item red" onClick={() => { fabricCanvas.current.remove(contextMenu.target); setContextMenu(null); }}><Trash2 size={14} /> Remove Layer</div>
          </div>
        )
      }

      <footer className="footer-bar">
        <span>OPEN LOVART CANVAS v0.2</span>
        <span>{fabricCanvas.current?.width}x{fabricCanvas.current?.height}</span>
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>Tool: {activeTool.toUpperCase()}</span>
        <span>Tip: Hold Space to Pan</span>
        <button className="action-tag footer-action-btn" onClick={() => setShowShortcutsModal(true)}>? Shortcuts</button>
      </footer>

      {showShortcutsModal && (
        <div className="modal-overlay" onClick={() => setShowShortcutsModal(false)}>
          <div className="confirm-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-text">
              <h3>Keyboard Shortcuts</h3>
              <div className="shortcuts-list">
                {SHORTCUT_DEFINITIONS.map((shortcut) => (
                  <div key={shortcut.id} className="shortcut-row">
                    <span>{shortcut.label}</span>
                    <kbd>{shortcut.keyLabel}</kbd>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn confirm" onClick={() => setShowShortcutsModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showRemoveBgConfirm && (
        <div className="modal-overlay" onClick={() => !isAiProcessing && setShowRemoveBgConfirm(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-icon-circle">
              <Sparkles size={32} />
            </div>
            <div className="modal-text">
              <h3>Remove Background?</h3>
              <p>AI will analyze the image and remove the background. This action can be undone.</p>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setShowRemoveBgConfirm(false)}
                disabled={isAiProcessing}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={removeBackground}
                disabled={isAiProcessing}
              >
                {isAiProcessing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* SAM 3 Segmentation Modal */}
      {showSegmentModal && (
        <div className="modal-overlay" onClick={() => !isAiProcessing && setShowSegmentModal(false)}>
          <div className="confirm-modal segment-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-icon-circle segment">
              <Scissors size={28} />
            </div>
            <div className="modal-text">
              <h3>Segment Object</h3>
              <p>Type what you want to extract from the image.</p>
              <div className="modal-input-group">
                <input
                  type="text"
                  placeholder="e.g. person, statue, cat..."
                  className="modal-input"
                  value={segmentText}
                  onChange={(e) => setSegmentText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && executeSegment(segmentText)}
                  autoFocus
                />
                {(marks.length > 0 || promptBox) && (
                  <p className="mark-status">
                    <Target size={12} style={{ marginRight: 4 }} />
                    {marks.length > 0 ? `${marks.length} points` : ''}
                    {marks.length > 0 && promptBox ? ' & ' : ''}
                    {promptBox ? 'Area Selection' : ''} will be used
                  </p>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setShowSegmentModal(false)}
                disabled={isAiProcessing}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm segment"
                onClick={() => executeSegment(segmentText)}
                disabled={isAiProcessing || (!segmentText && marks.length === 0 && !promptBox)}
              >
                {isAiProcessing ? 'Processing...' : 'Segment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default App;
