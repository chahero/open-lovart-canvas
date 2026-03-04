import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, MousePointer2, Square, Type, Image as ImageIcon, Maximize,
  Layers as LayersIcon, Settings, Download, Trash2, Eye, EyeOff, Eraser, Circle,
  MoreHorizontal, Sparkles, Scissors, Target, Edit3, RotateCcw, AlertTriangle, Link2, Unlink2,
  RotateCw, Search, Hand, AlignLeft, AlignCenter,
  AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, Group, Ungroup, Bold, Italic, Type as TypeIcon, Play,
  ChevronUp, ChevronDown
} from 'lucide-react';
import * as fabric from 'fabric';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WORLD_CANVAS_WIDTH = 5000;
const WORLD_CANVAS_HEIGHT = 5000;
const PROMPT_HISTORY_STORAGE_KEY = 'open_lovart_prompt_history_v1';
const PROMPT_HISTORY_LIMIT = 80;
const EMPTY_PROMPT_HISTORY = {
  t2i: [],
  i2i_single: [],
  i2i_multi: [],
  upscale: [],
};
const sanitizePromptHistoryEntry = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizePromptHistoryMap = (raw) => {
  const next = { ...EMPTY_PROMPT_HISTORY };
  if (!raw || typeof raw !== 'object') return next;
  Object.keys(next).forEach((modeKey) => {
    const source = Array.isArray(raw[modeKey]) ? raw[modeKey] : [];
    const unique = [];
    source.forEach((item) => {
      const normalized = sanitizePromptHistoryEntry(item);
      if (!normalized || unique.includes(normalized)) return;
      unique.push(normalized);
    });
    next[modeKey] = unique.slice(0, PROMPT_HISTORY_LIMIT);
  });
  return next;
};
const SHORTCUT_DEFINITIONS = [
  { id: 'select', label: 'Selection', key: 'v', keyLabel: 'V' },
  { id: 'pan', label: 'Hand / Pan', key: 'h', keyLabel: 'H' },
  { id: 'panHold', label: 'Pan (Hold)', keyLabel: 'Space', displayOnly: true },
  { id: 'mark', label: 'Mask Brush', key: 'm', keyLabel: 'M' },
  { id: 'eraser', label: 'Eraser', key: 'e', keyLabel: 'E' },
  { id: 'rect', label: 'Rectangle', key: 'r', keyLabel: 'R' },
  { id: 'circle', label: 'Circle', key: 'o', keyLabel: 'O' },
  { id: 'text', label: 'Text', key: 't', keyLabel: 'T' },
  { id: 'imageUpload', label: 'Image Upload', key: 'i', keyLabel: 'I' },
  { id: 'toggleShortcuts', label: 'Toggle This Help', key: '?', keyLabel: '?' },
];
const ROUNDNESS_DRAG_SENSITIVITY = 0.7;

let hasConfiguredRectRoundControls = false;
const buildRoundControl = () => {
  if (!fabric.Control || !fabric.controlsUtils) return null;

  return new fabric.Control({
    x: 0.5,
    y: -0.5,
    offsetX: 26,
    offsetY: -26,
    sizeX: 12,
    sizeY: 12,
    cornerStyle: 'circle',
    render: fabric.controlsUtils.renderCircleControl,
    cursorStyle: 'nwse-resize',
    actionHandler: fabric.controlsUtils.wrapWithFixedAnchor((eventData, transform, x, y) => {
      const target = transform?.target;
      if (!target || (target.type !== 'rect' && target.type !== 'Rect')) return false;

      const inv = fabric.util.invertTransform(target.calcTransformMatrix());
      const local = fabric.util.transformPoint(new fabric.Point(x, y), inv);
      const state = (transform.__roundnessDragState ||= {});
      if (!state.uniformRadius) {
        const start = (Number(target.rx || 0) + Number(target.ry || 0)) / 2;
        state.uniformRadius = {
          startValue: start,
          startX: local.x,
          startY: local.y,
        };
      }

      const scaledWidth = Math.abs(target.getScaledWidth ? target.getScaledWidth() : ((target.width || 0) * (target.scaleX || 1)));
      const scaledHeight = Math.abs(target.getScaledHeight ? target.getScaledHeight() : ((target.height || 0) * (target.scaleY || 1)));
      const maxRadius = Math.max(0, Math.min(scaledWidth, scaledHeight) / 2);
      const deltaX = local.x - state.uniformRadius.startX;
      const deltaY = local.y - state.uniformRadius.startY;
      const delta = (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY) * ROUNDNESS_DRAG_SENSITIVITY;
      const nextValue = state.uniformRadius.startValue + delta;
      const clamped = Math.max(0, Math.min(maxRadius, nextValue));

      target.set({
        rx: clamped,
        ry: clamped,
      });

      target.setCoords();
      if (target.canvas) target.canvas.requestRenderAll();
      return true;
    }),
    mouseUpHandler: (eventData, transform) => {
      if (!transform || !transform.__roundnessDragState) return false;
      transform.__roundnessDragState = null;
      return false;
    },
    actionName: 'roundness',
  });
};

const ensureRectRoundControls = (obj) => {
  if (!obj) return;
  if (obj.type !== 'rect' && obj.type !== 'Rect') return;
  obj.strokeUniform = true;
  const controls = obj.controls;
  if (!controls) return;

  if (controls.rxRound) delete controls.rxRound;
  if (controls.ryRound) delete controls.ryRound;
  if (!controls.roundness) controls.roundness = buildRoundControl();
};

const configureRectRoundControls = () => {
  if (hasConfiguredRectRoundControls) return;
  if (!fabric.Rect || !fabric.Control || !fabric.controlsUtils) return;

  const baseControls = fabric.Rect.prototype.controls;
  if (!baseControls) return;
  if (!fabric.controlsUtils.renderCircleControl || !fabric.controlsUtils.wrapWithFixedAnchor) return;
  if (fabric.Rect.prototype) {
    fabric.Rect.prototype.strokeUniform = true;
  }
  if (!baseControls.roundness) baseControls.roundness = buildRoundControl();
  if (baseControls.rxRound) delete baseControls.rxRound;
  if (baseControls.ryRound) delete baseControls.ryRound;

  hasConfiguredRectRoundControls = true;
};

const App = () => {
  // --- States ---
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [maskStrokes, setMaskStrokes] = useState([]);
  const [maskTargetId, setMaskTargetId] = useState(null);
  const [showAiInput, setShowAiInput] = useState(false);
  const [activeAiMode, setActiveAiMode] = useState('t2i');
  const [isDragging, setIsDragging] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [zoom, setZoom] = useState(1);
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
  const [showAiValidationModal, setShowAiValidationModal] = useState(false);
  const [aiValidationTitle, setAiValidationTitle] = useState('AI Generation Error');
  const [aiValidationMessage, setAiValidationMessage] = useState('');
  const [eraserSize, setEraserSize] = useState(28);
  const [maskBrushSize, setMaskBrushSize] = useState(36);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [isLibrarySaving, setIsLibrarySaving] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [editingAssetName, setEditingAssetName] = useState('');
  const [isRenamingAsset, setIsRenamingAsset] = useState(false);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState(null);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);
  const [activePanelTab, setActivePanelTab] = useState('properties');
  const [activeSettingsTab, setActiveSettingsTab] = useState('comfyui');
  const [showAlignmentHint, setShowAlignmentHint] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showExportOptionsModal, setShowExportOptionsModal] = useState(false);
  const [showExportNoSelectionModal, setShowExportNoSelectionModal] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [exportFormat, setExportFormat] = useState('png');
  const [exportWidth, setExportWidth] = useState('');
  const [exportHeight, setExportHeight] = useState('');
  const [exportKeepAspect, setExportKeepAspect] = useState(true);
  const [exportAspectRatio, setExportAspectRatio] = useState(1);
  const [showVideoPlayerModal, setShowVideoPlayerModal] = useState(false);
  const [videoPlayerSource, setVideoPlayerSource] = useState('');
  const [videoPlayerTitle, setVideoPlayerTitle] = useState('');
  const [promptHistoryByMode, setPromptHistoryByMode] = useState(() => ({ ...EMPTY_PROMPT_HISTORY }));
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [settingsOptions, setSettingsOptions] = useState({
    workflows: [],
    ocrModels: [],
  });
  const [settingsDraft, setSettingsDraft] = useState({
    ollama: '',
    comfyui: '',
    workflow: '',
    workflowMap: {
      t2i: '',
      i2i_single: '',
      i2i_multi: '',
      upscale: '',
    },
    ocrModel: '',
  });

  const aiModeConfig = [
    { key: 't2i', label: 'T2I Generate', promptRequired: true, minImageLayers: 0 },
    { key: 'i2i_single', label: 'I2I (Single)', promptRequired: true, minImageLayers: 1 },
    { key: 'i2i_multi', label: 'I2I (Multi)', promptRequired: true, minImageLayers: 2 },
    { key: 'upscale', label: 'Upscale', promptRequired: false, minImageLayers: 1 },
  ];

  const getAiModeConfig = (mode = 't2i') => {
    const normalizedMode = mode === 'i2i' ? 'i2i_single' : mode;
    return aiModeConfig.find((entry) => entry.key === normalizedMode) || aiModeConfig[0];
  };
  const getPromptHistoryForMode = (mode = 't2i') => {
    const modeKey = getAiModeConfig(mode).key;
    return promptHistoryByMode?.[modeKey] || [];
  };
  const savePromptToHistory = (mode, promptText) => {
    const normalizedPrompt = sanitizePromptHistoryEntry(promptText);
    if (!normalizedPrompt) return;
    const modeKey = getAiModeConfig(mode).key;
    setPromptHistoryByMode((prev) => {
      const current = Array.isArray(prev?.[modeKey]) ? prev[modeKey] : [];
      return {
        ...prev,
        [modeKey]: [normalizedPrompt, ...current.filter((item) => item !== normalizedPrompt)].slice(0, PROMPT_HISTORY_LIMIT),
      };
    });
  };
  const removePromptFromHistory = (mode, promptText) => {
    const modeKey = getAiModeConfig(mode).key;
    setPromptHistoryByMode((prev) => {
      const current = Array.isArray(prev?.[modeKey]) ? prev[modeKey] : [];
      return {
        ...prev,
        [modeKey]: current.filter((item) => item !== promptText),
      };
    });
  };

  const normalizeWorkflowMapFromConfig = (config = {}) => {
const rawMap = config.workflow_map;
  return {
    t2i: String(rawMap?.t2i || config.workflow || '').trim(),
    i2i_single: String(rawMap?.i2i_single || rawMap?.i2i || '').trim(),
    i2i_multi: String(rawMap?.i2i_multi || '').trim(),
    upscale: String(rawMap?.upscale || '').trim(),
  };
};

  const showNoticeModal = (title, message) => {
    setAiValidationTitle(title || 'Notice');
    setAiValidationMessage(message || 'An error occurred.');
    setShowAiValidationModal(true);
  };

  // --- Refs ---
  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);
  const canvasContainerRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const maskStrokesRef = useRef(maskStrokes);
  const maskTargetIdRef = useRef(maskTargetId);
  const alignmentHintTimerRef = useRef(null);
  const dragCounter = useRef(0);
  const isSpacePanRef = useRef(false);
  const eraserSizeRef = useRef(eraserSize);
  const maskBrushSizeRef = useRef(maskBrushSize);
  const eraserCursorRef = useRef(null);
  const maskOverlayRef = useRef(null);
  const imageInputRef = useRef(null);
  const projectFileInputRef = useRef(null);
  const isFillDraftingRef = useRef(false);
  const fillDraftRef = useRef(null);
  const fillPreviewSessionRef = useRef({ active: false, objectId: null, startFill: null });
  const suspendMaskOverlayUntilRef = useRef(0);
  const rightClickActiveSelectionIdsRef = useRef([]);
  const rightClickSelectionEpochRef = useRef(0);
  const topbarMenuRef = useRef(null);
  const promptHistoryRef = useRef(null);

  // --- Sync Refs ---
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { maskStrokesRef.current = maskStrokes; }, [maskStrokes]);
  useEffect(() => { maskTargetIdRef.current = maskTargetId; }, [maskTargetId]);
  useEffect(() => { eraserSizeRef.current = eraserSize; }, [eraserSize]);
  useEffect(() => { maskBrushSizeRef.current = maskBrushSize; }, [maskBrushSize]);
  useEffect(() => {
    if (!selectedObject) {
      isFillDraftingRef.current = false;
      fillDraftRef.current = null;
      fillPreviewSessionRef.current = { active: false, objectId: null, startFill: null };
      return;
    }
    if (isFillDraftingRef.current) return;
    const fill = selectedObject.fill;
    fillDraftRef.current = typeof fill === 'string' && fill.startsWith('#') ? fill : '#6366f1';
    fillPreviewSessionRef.current = { active: false, objectId: selectedObject.id ?? null, startFill: null };
  }, [selectedObject?.id, selectedObject?.fill]);
  useEffect(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    if (activeTool === 'eraser' || activeTool === 'mark') {
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
    if (!showProjectMenu) return;

    const onPointerDown = (event) => {
      if (!topbarMenuRef.current) return;
      if (!topbarMenuRef.current.contains(event.target)) {
        setShowProjectMenu(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [showProjectMenu]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROMPT_HISTORY_STORAGE_KEY);
      if (!raw) return;
      setPromptHistoryByMode(normalizePromptHistoryMap(JSON.parse(raw)));
    } catch (err) {
      console.warn('[PromptHistory] failed to read cache', err);
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(promptHistoryByMode));
    } catch (err) {
      console.warn('[PromptHistory] failed to write cache', err);
    }
  }, [promptHistoryByMode]);
  useEffect(() => {
    if (!showPromptHistory) return;
    const onPointerDown = (event) => {
      if (!promptHistoryRef.current) return;
      if (!promptHistoryRef.current.contains(event.target)) {
        setShowPromptHistory(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [showPromptHistory]);

  const syncUI = useCallback(() => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const objs = canvas.getObjects()
      .filter(obj => obj.id !== 'world-bounds')
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
        stroke: activeObj.stroke,
        strokeWidth: activeObj.strokeWidth,
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
        mediaType: activeObj.mediaType || '',
        mediaSource: activeObj.mediaSource || '',
        displayWidth: Math.max(0, Math.round(
          typeof activeObj.getScaledWidth === 'function'
            ? activeObj.getScaledWidth()
            : (activeObj.width || 0) * (activeObj.scaleX || 1)
        )),
        displayHeight: Math.max(0, Math.round(
          typeof activeObj.getScaledHeight === 'function'
            ? activeObj.getScaledHeight()
            : (activeObj.height || 0) * (activeObj.scaleY || 1)
        )),
        sourceWidth: Math.max(0, Math.round(activeObj.width || 0)),
        sourceHeight: Math.max(0, Math.round(activeObj.height || 0)),
      });
    } else {
      setSelectedObject(null);
    }
  }, []);

  const isActiveSelectionType = (obj) => (
    typeof obj?.type === 'string' && obj.type.toLowerCase() === 'activeselection'
  );

  const createGroupFromActiveObjects = (canvas) => {
    const active = canvas.getActiveObject();
    const activeObjects = (canvas.getActiveObjects ? canvas.getActiveObjects() : []).filter((obj) => obj?.id !== 'world-bounds');
    if (!active || !isActiveSelectionType(active) || activeObjects.length < 2) return null;

    if (typeof active.toGroup === 'function') {
      return active.toGroup();
    }

    if (typeof fabric.Group === 'undefined') return null;

    const allObjects = canvas.getObjects ? canvas.getObjects() : [];
    const objectIndexes = activeObjects.map((obj) => allObjects.indexOf(obj)).filter((idx) => idx >= 0);
    const targetIndex = objectIndexes.length ? Math.min(...objectIndexes) : null;

    canvas.discardActiveObject();
    activeObjects.forEach((obj) => canvas.remove(obj));
    const grouped = new fabric.Group(activeObjects, {});
    canvas.add(grouped);
    if (typeof canvas.moveTo === 'function' && targetIndex !== null && Number.isFinite(targetIndex)) {
      canvas.moveTo(grouped, targetIndex);
    }
    if (typeof canvas.setActiveObject === 'function') {
      canvas.setActiveObject(grouped);
    }
    return grouped;
  };

  const createUngroupFromActiveGroup = (groupObj, canvas) => {
    if (!groupObj || groupObj.type !== 'group') return null;

    const childObjects = [...(groupObj._objects || groupObj.getObjects?.() || [])].filter(Boolean);
    if (!childObjects.length) {
      canvas.discardActiveObject();
      canvas.remove(groupObj);
      return [];
    }

    const allObjects = canvas.getObjects ? canvas.getObjects() : [];
    const insertionIndex = allObjects.indexOf(groupObj);
    canvas.discardActiveObject();
    canvas.remove(groupObj);

    const restoredObjects = [];
    childObjects.forEach((obj) => {
      if (obj) {
        if (typeof groupObj.exitGroup === 'function') {
          groupObj.exitGroup(obj, false);
        } else if (typeof groupObj._exitGroup === 'function') {
          groupObj._exitGroup(obj, false);
        }
        if (typeof obj._set === 'function') {
          obj._set('canvas', canvas);
          obj._set('parent', undefined);
        } else {
          obj.canvas = canvas;
          obj.parent = undefined;
        }
        if (typeof canvas.add === 'function' && !canvas.contains?.(obj)) {
          canvas.add(obj);
        }
        restoredObjects.push(obj);
      }
    });

    if (typeof canvas.moveTo === 'function' && insertionIndex >= 0 && restoredObjects.length > 0) {
      restoredObjects.forEach((obj, idx) => {
        canvas.moveTo(obj, insertionIndex + idx);
      });
    }

    if (typeof canvas.setActiveObject === 'function') {
      if (restoredObjects.length > 1) {
        setActiveObjectOrSelection(restoredObjects);
      } else {
        canvas.setActiveObject(restoredObjects[0]);
      }
    }

    return restoredObjects;
  };

  const expandGroupToSelection = (groupObj, canvas) => {
    if (!groupObj || groupObj.type !== 'group') return false;

    if (typeof groupObj.toActiveSelection === 'function') {
      try {
        groupObj.toActiveSelection();
        return true;
      } catch (_error) {}
    }

    createUngroupFromActiveGroup(groupObj, canvas);
    return true;
  };

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

  const drawMaskOverlay = useCallback(() => {
    const canvas = fabricCanvas.current;
    const overlay = maskOverlayRef.current;
    if (!canvas || !overlay) return;
    if (performance.now() < suspendMaskOverlayUntilRef.current) {
      overlay.style.display = 'none';
      return;
    }

    const width = Math.max(1, Math.round(canvas.getWidth() || 1));
    const height = Math.max(1, Math.round(canvas.getHeight() || 1));
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const strokes = maskStrokesRef.current || [];

    if (strokes.length === 0) {
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = 'block';

    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const approxZoom = Math.max(0.001, Math.hypot(vpt[0] || 1, vpt[1] || 0));

    const toScreenPoint = (pt) => ({
      x: pt.x * vpt[0] + pt.y * vpt[2] + vpt[4],
      y: pt.x * vpt[1] + pt.y * vpt[3] + vpt[5],
    });

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) {
      if (!stroke?.points?.length) continue;
      const lineWidth = Math.max(2, (stroke.size || 1) * approxZoom);
      const first = toScreenPoint(stroke.points[0]);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
      ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
      ctx.lineWidth = lineWidth;

      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = toScreenPoint(stroke.points[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    if (stats.active) {
      stats.overlayCount += 1;
      stats.overlayMsTotal += (performance.now() - startedAt);
    }
  }, []);

  useEffect(() => {
    drawMaskOverlay();
  }, [drawMaskOverlay, maskStrokes, zoom]);

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
          },
          options: {
            workflows: [],
            ocr_models: [],
          },
        };
      } else {
        if (!response.ok) throw new Error('Failed to load server config');
        data = await response.json();
      }

      const config = data.config || {};
      const options = data.options || {};
      const workflowMap = normalizeWorkflowMapFromConfig(config);
      setSettingsDraft({
        ollama: config.ollama || '',
        comfyui: config.comfyui || '',
        workflow: config.workflow || '',
        workflowMap,
        ocrModel: config.ocr_model || '',
      });
      setSettingsOptions({
        workflows: options.workflows || [],
        ocrModels: options.ocr_models || [],
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

  useEffect(() => {
    loadServerSettings();
  }, [loadServerSettings]);

  const saveServerSettings = async () => {
    setIsSettingsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/config/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama: settingsDraft.ollama,
          comfyui: settingsDraft.comfyui,
          workflow: settingsDraft.workflowMap?.t2i || settingsDraft.workflow,
          workflow_map: settingsDraft.workflowMap,
          ocr_model: settingsDraft.ocrModel,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save settings');
      }

      const data = await response.json();
      const config = data.config || {};
      const options = data.options || {};
      const workflowMap = normalizeWorkflowMapFromConfig(config);
      setSettingsDraft({
        ollama: config.ollama || '',
        comfyui: config.comfyui || '',
        workflow: config.workflow || '',
        workflowMap,
        ocrModel: config.ocr_model || '',
      });
      setSettingsOptions({
        workflows: options.workflows || [],
        ocrModels: options.ocr_models || [],
      });
      setShowSettingsModal(false);
    } catch (err) {
      console.error(err);
      showNoticeModal('Settings Error', 'Settings save failed: ' + (err?.message || 'Unknown error.'));
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
    } catch (err) {
      console.error(err);
      showNoticeModal('Library Error', 'Failed to insert library asset: ' + (err?.message || 'Unknown error.'));
    }
  };

  const createVideoPosterDataFromSource = (mediaSource, revokeOnFinish = false) => new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = mediaSource;
    let settled = false;

    const cleanup = () => {
      settled = true;
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      if (revokeOnFinish) {
        try { URL.revokeObjectURL(mediaSource); } catch (_) { /* noop */ }
      }
    };

    const captureFrame = () => {
      if (settled) return;
      try {
        const width = Math.max(1, video.videoWidth || 1);
        const height = Math.max(1, video.videoHeight || 1);
        const posterCanvas = document.createElement('canvas');
        posterCanvas.width = width;
        posterCanvas.height = height;
        const ctx = posterCanvas.getContext('2d');
        if (!ctx) throw new Error('Could not create video poster canvas.');
        ctx.drawImage(video, 0, 0, width, height);
        const posterDataUrl = posterCanvas.toDataURL('image/png');
        cleanup();
        resolve({ posterDataUrl, mediaSource });
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.onloadedmetadata = () => {
      if (settled) return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTime = duration > 0.2 ? 0.12 : 0;
      try {
        if (seekTime > 0) {
          video.currentTime = Math.min(seekTime, Math.max(0, duration - 0.05));
          return;
        }
      } catch (_) {
        // If seek fails, fallback to immediate capture.
      }
      captureFrame();
    };

    video.onseeked = captureFrame;
    video.onloadeddata = captureFrame;
    video.onerror = () => {
      if (settled) return;
      cleanup();
      reject(new Error('Failed to decode video source.'));
    };
  });

  const addVideoFromAsset = async (asset, dropPoint = null) => {
    if (!asset?.url) return;
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    try {
      const mediaSource = toAbsoluteAssetUrl(asset.url);
      const { posterDataUrl } = await createVideoPosterDataFromSource(mediaSource, false);
      const poster = await loadFabricImage(posterDataUrl);
      poster.scaleToWidth(400);
      poster.name = asset.name || 'Library Video';
      poster.mediaType = 'video';
      poster.mediaSource = mediaSource;
      canvas.add(poster);
      placeObjectAtDropOrCenter(canvas, poster, dropPoint);
      canvas.setActiveObject(poster);
      setActiveTool('select');
      canvas.requestRenderAll();
    } catch (err) {
      console.error(err);
      showNoticeModal('Library Error', 'Failed to insert video asset: ' + (err?.message || 'Unknown error.'));
    }
  };

  const addAssetToCanvas = async (asset) => {
    const contentType = String(asset?.content_type || '').toLowerCase();
    if (contentType.startsWith('video/')) {
      await addVideoFromAsset(asset);
      return;
    }
    await addImageFromAsset(asset);
  };

  const saveSelectedAssetToLibrary = async () => {
    const canvas = fabricCanvas.current;
    const active = canvas?.getActiveObject();
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) {
      showNoticeModal('Library Error', 'Select an image or video layer first.');
      return;
    }

    setIsLibrarySaving(true);
    try {
      const isVideoLayer = active.mediaType === 'video' && typeof active.mediaSource === 'string' && active.mediaSource.length > 0;
      const safeBaseName = (active.name || (isVideoLayer ? 'video' : 'asset')).replace(/[^a-z0-9-_]+/gi, '_');

      let blob = null;
      let fileName = `${safeBaseName}.png`;

      if (isVideoLayer) {
        const mediaResponse = await fetch(active.mediaSource);
        if (!mediaResponse.ok) throw new Error('Failed to read selected video source.');
        blob = await mediaResponse.blob();
        const type = String(blob.type || '').toLowerCase();
        const ext = type.includes('webm')
          ? '.webm'
          : type.includes('ogg')
            ? '.ogv'
            : type.includes('quicktime')
              ? '.mov'
              : '.mp4';
        fileName = `${safeBaseName}${ext}`;
      } else {
        const dataURL = active.toDataURL({ format: 'png' });
        blob = await (await fetch(dataURL)).blob();
      }

      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('source', 'canvas');
      formData.append('name', active.name || (isVideoLayer ? 'Canvas Video' : 'Canvas Image'));

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
      showNoticeModal('Library Error', 'Failed to save library asset: ' + (err?.message || 'Unknown error.'));
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
      showNoticeModal('Library Error', 'Failed to delete library asset: ' + (err?.message || 'Unknown error.'));
    } finally {
      setIsDeletingAsset(false);
    }
  };

  const getAssetDisplayName = (assetName) => {
    const raw = String(assetName || '').trim();
    if (!raw) return 'Untitled';
    return raw.replace(/\.[^./\\]+$/, '');
  };

  const renameAssetInLibrary = async (assetId, newName) => {
    if (!assetId) return;
    const normalizedName = getAssetDisplayName(newName);
    if (!normalizedName) {
      setEditingAssetId(null);
      setEditingAssetName('');
      return;
    }

    try {
      setIsRenamingAsset(true);
      const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: normalizedName }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to rename asset');
      }
      const data = await response.json();
      const updated = data.item;
      if (updated) {
        setAssetLibrary((prev) => prev.map((item) => (item.id === assetId ? updated : item)));
      }
    } catch (err) {
      console.error(err);
      showNoticeModal('Library Error', 'Failed to rename library asset: ' + (err?.message || 'Unknown error.'));
    } finally {
      setEditingAssetId(null);
      setEditingAssetName('');
      setIsRenamingAsset(false);
    }
  };

  const hydrateRoundControlsForRects = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    canvas.getObjects().forEach((obj) => ensureRectRoundControls(obj));
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
    configureRectRoundControls();

    const canvas = new fabric.Canvas(canvasRef.current, {
      backgroundColor: 'transparent',
      width: canvasContainerRef.current?.clientWidth || 900,
      height: canvasContainerRef.current?.clientHeight || 650,
      preserveObjectStacking: true,
      stopContextMenu: true,
      skipOffscreen: false,
    });
    canvas.uniformScaling = true;
    canvas.uniScaleKey = 'shiftKey';

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
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      visible: false,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      excludeFromExport: true,
      isWorldBounds: true,
      name: 'world-bounds',
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
    const resetMoveLockState = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.__moveLockState) delete obj.__moveLockState;
    };
    canvas.on('mouse:down', (evt) => {
      const target = evt?.target;
      if (!target || target.id === 'world-bounds') return;
      target.__moveLockState = {
        startLeft: Number(target.left || 0),
        startTop: Number(target.top || 0),
        axis: null,
      };
    });
    canvas.on('object:moving', (e) => {
      const obj = e.target;
      const moveEvent = e?.e;
      if (obj && obj.id !== 'world-bounds') {
        // Move is more natural as free by default; Shift enables axis lock.
        if (moveEvent?.shiftKey) {
          const state = obj.__moveLockState || {
            startLeft: Number(obj.left || 0),
            startTop: Number(obj.top || 0),
            axis: null,
          };
          const dx = Number(obj.left || 0) - state.startLeft;
          const dy = Number(obj.top || 0) - state.startTop;
          if (!state.axis) {
            state.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          }
          if (state.axis === 'x') {
            obj.set({ top: state.startTop });
          } else {
            obj.set({ left: state.startLeft });
          }
          obj.__moveLockState = state;
        } else {
          obj.__moveLockState = {
            startLeft: Number(obj.left || 0),
            startTop: Number(obj.top || 0),
            axis: null,
          };
        }
      }

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
    canvas.on('object:rotating', (e) => {
      const obj = e?.target;
      if (!obj) return;
      // Consistent key rule: default constrained, Shift unlocks free transform.
      if (e?.e?.shiftKey) return;
      const step = 15;
      const angle = Number(obj.angle || 0);
      obj.set({ angle: Math.round(angle / step) * step });
    });

    canvas.on('object:added', (evt) => {
      ensureRectRoundControls(evt?.target);
      stabilizeRasterObject(evt?.target);
      syncUI();
    });
    canvas.on('object:removed', (evt) => {
      resetMoveLockState(evt?.target);
      syncUI();
    });
    canvas.on('object:modified', (evt) => {
      resetMoveLockState(evt?.target);
      syncUI();
    });
    canvas.on('object:scaling', syncUI);
    canvas.on('selection:created', () => {
      const targets = canvas.getActiveObjects?.() || [];
      targets.forEach((obj) => ensureRectRoundControls(obj));
      syncUI();
    });
    canvas.on('selection:updated', () => {
      const targets = canvas.getActiveObjects?.() || [];
      targets.forEach((obj) => ensureRectRoundControls(obj));
      syncUI();
    });
    canvas.on('selection:cleared', () => {
      syncUI();
    });
    canvas.on('after:render', drawMaskOverlay);

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
    let isMaskDrawing = false;
    let eraserTarget = null;
    let currentMaskStrokeId = null;
    let lastMaskPoint = null;

    const isImageObject = (obj) => obj && (obj.type === 'FabricImage' || obj.type === 'image');
    const hideEraserCursor = () => {
      if (eraserCursorRef.current) eraserCursorRef.current.style.display = 'none';
    };
    const moveBrushCursor = (e) => {
      if ((activeToolRef.current !== 'eraser' && activeToolRef.current !== 'mark') || !eraserCursorRef.current) return;
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
        canvas.remove(target);
        canvas.add(nextImg);
        canvas.setActiveObject(nextImg);
        canvas.requestRenderAll();
        syncUI();
      }).catch((err) => {
        console.error('Failed to finalize eraser image:', err);
      });
    };

    const handleMouseUp = () => {
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

      if (isMaskDrawing) {
        isMaskDrawing = false;
        currentMaskStrokeId = null;
        lastMaskPoint = null;
        setMaskStrokes([...(maskStrokesRef.current || [])]);
        canvas.selection = activeToolRef.current !== 'mark';
        canvas.upperCanvasEl.style.cursor = activeToolRef.current === 'mark'
          ? 'none'
          : (isSpacePanRef.current || activeToolRef.current === 'pan' ? 'grab' : '');
        return;
      }

      if (isPanning) {
        isPanning = false;
        canvas.setViewportTransform(canvas.viewportTransform);
        syncArtboardPattern();
        canvas.upperCanvasEl.style.cursor = isSpacePanRef.current || activeToolRef.current === 'pan' ? 'grab' : '';
      }
      isPanning = false;
      canvas.selection = activeToolRef.current !== 'mark' && activeToolRef.current !== 'eraser';
    };

    let suppressNextNativeContextMenu = false;
    let rightClickRestoreTimer = null;

    const handleMouseDown = (opt) => {
      const button = Number.isFinite(opt?.button) ? opt.button : undefined;
      const eventButton = Number.isFinite(opt?.e?.button) ? opt.e.button : undefined;
      const eventWhich = Number.isFinite(opt?.e?.which) ? opt.e.which : undefined;
      const isRightButton = button === 2 || button === 3 || eventButton === 2 || eventButton === 3 || eventWhich === 3;
      const rightClickPointer = isRightButton ? canvas.getScenePoint(opt.e) : null;
      const resolvedRightTarget = isRightButton
        ? (opt.target && opt.target.id !== 'world-bounds'
          ? opt.target
          : canvas.getObjects()
            .slice()
            .reverse()
            .find((obj) => obj.visible !== false && obj.id !== 'world-bounds' && obj.containsPoint(rightClickPointer)))
        : null;
      if (activeToolRef.current === 'eraser') {
        const active = canvas.getActiveObject();
        const pointer = canvas.getScenePoint(opt.e);
        moveBrushCursor(opt.e);
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

      if (activeToolRef.current === 'mark' && !isSpacePanRef.current && !isRightButton) {
        const pointer = canvas.getScenePoint(opt.e);
        moveBrushCursor(opt.e);

        const images = canvas.getObjects().filter((o) => isImageObject(o));
        const hittedImage = opt.target && isImageObject(opt.target)
          ? opt.target
          : images.find((img) => img.containsPoint(pointer));
        const finalTarget = hittedImage || (images.length === 1 ? images[0] : null);

        if (!finalTarget) {
          canvas.upperCanvasEl.style.cursor = 'none';
          return;
        }

        if (!finalTarget.id) {
          finalTarget.id = Math.random().toString(36).slice(2, 11);
        }

        const prevTargetId = maskTargetIdRef.current;
        const existingStrokes = maskStrokesRef.current || [];
        if (prevTargetId && prevTargetId !== finalTarget.id && existingStrokes.length > 0) {
          maskStrokesRef.current = [];
          setMaskStrokes([]);
        }

        setMaskTargetId(finalTarget.id);
        canvas.setActiveObject(finalTarget);
        setContextMenu(null);
        canvas.selection = false;
        canvas.upperCanvasEl.style.cursor = 'none';
        opt.e.preventDefault();
        opt.e.stopPropagation();

        isMaskDrawing = true;
        currentMaskStrokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        lastMaskPoint = pointer;

        const stroke = {
          id: currentMaskStrokeId,
          size: Math.max(2, maskBrushSizeRef.current || 1),
          points: [{ x: pointer.x, y: pointer.y }],
        };
        maskStrokesRef.current = [...(maskStrokesRef.current || []), stroke];
        setMaskStrokes(maskStrokesRef.current);
        drawMaskOverlay();
        return;
      }

      const clickedCanvasObject = opt.target && opt.target.id !== 'world-bounds';
      if (
        clickedCanvasObject &&
        !isRightButton &&
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
      const activeObject = canvas.getActiveObject();
      const activeSelectionTargets = canvas.getActiveObjects
        ? canvas.getActiveObjects().filter((obj) => obj && obj.id !== 'world-bounds')
        : [];
      const multiSelectionCount = activeSelectionTargets.length;
      const isRightTargetInActiveSelection = multiSelectionCount > 1
        && resolvedRightTarget
        && (
          resolvedRightTarget === activeObject
          || isActiveSelectionType(resolvedRightTarget)
          || activeSelectionTargets.includes(resolvedRightTarget)
        );

      if (isRightButton && resolvedRightTarget) {
        opt.e?.preventDefault?.();
        opt.e?.stopPropagation?.();
        if (isRightTargetInActiveSelection) {
          const selectedIds = activeSelectionTargets
            .map((obj) => obj?.id)
            .filter(Boolean);
          if (selectedIds.length > 1) {
            rightClickActiveSelectionIdsRef.current = selectedIds;
            const restoreEpoch = ++rightClickSelectionEpochRef.current;
            if (rightClickRestoreTimer) {
              window.clearTimeout(rightClickRestoreTimer);
            }
            rightClickRestoreTimer = window.setTimeout(() => {
              if (rightClickSelectionEpochRef.current !== restoreEpoch) {
                return;
              }
              const currentActive = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
              const currentActiveIds = currentActive.map((obj) => obj?.id).filter(Boolean);
              const hasMissingSelection = selectedIds.some((id) => !currentActiveIds.includes(id)) || currentActive.length <= 1;
              if (!hasMissingSelection) {
                return;
              }
              const restoredTargets = selectedIds
                .map((id) => canvas.getObjects().find((obj) => obj?.id === id))
                .filter((obj) => Boolean(obj) && obj.id !== 'world-bounds');
              if (restoredTargets.length > 1) {
                setActiveObjectOrSelection(restoredTargets);
                syncUI();
              }
            }, 0);
          }
        } else {
          canvas.setActiveObject(resolvedRightTarget);
        }
        setContextMenu({ x: opt.e.clientX, y: opt.e.clientY, target: resolvedRightTarget });
        suppressNextNativeContextMenu = true;
        window.setTimeout(() => {
          suppressNextNativeContextMenu = false;
        }, 100);
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
      if ((activeToolRef.current === 'eraser' || activeToolRef.current === 'mark') && !isPanning && !isSpacePanRef.current) {
        moveBrushCursor(opt.e);
      }
      if (isErasing && eraserTarget) {
        const pointer = canvas.getScenePoint(opt.e);
        eraseAtScenePoint(eraserTarget, pointer);
        return;
      }
      if (isMaskDrawing && currentMaskStrokeId) {
        const pointer = canvas.getScenePoint(opt.e);
        if (lastMaskPoint) {
          const dx = pointer.x - lastMaskPoint.x;
          const dy = pointer.y - lastMaskPoint.y;
          if ((dx * dx + dy * dy) < 1.0) {
            return;
          }
        }
        lastMaskPoint = pointer;

        const strokes = maskStrokesRef.current || [];
        const nextStrokes = strokes.map((stroke) => {
          if (stroke.id !== currentMaskStrokeId) return stroke;
          return {
            ...stroke,
            points: [...stroke.points, { x: pointer.x, y: pointer.y }],
          };
        });
        maskStrokesRef.current = nextStrokes;
        drawMaskOverlay();
      }
    });

    const handleCanvasContextMenu = (e) => {
      if (suppressNextNativeContextMenu) {
        suppressNextNativeContextMenu = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const scenePointer = canvas.getScenePoint(e);
      const target = canvas.getObjects()
        .slice()
        .reverse()
        .find((obj) => obj.id !== 'world-bounds' && obj.containsPoint(scenePointer));
      const activeObject = canvas.getActiveObject();
      const activeSelectionTargets = canvas.getActiveObjects
        ? canvas.getActiveObjects().filter((obj) => obj && obj.id !== 'world-bounds')
        : [];
      const isMultiSelecting = activeSelectionTargets.length > 1;
      const targetToSet = isMultiSelecting
        && (target === activeObject || isActiveSelectionType(target) || activeSelectionTargets.includes(target))
        ? activeObject
        : target;

      e.preventDefault();
      e.stopPropagation();

      if (!targetToSet) {
        setContextMenu(null);
        return;
      }
      if (!activeObject || !isActiveSelectionType(activeObject) || activeObject !== targetToSet) {
        canvas.setActiveObject(targetToSet);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, target: targetToSet });
    };

    canvas.upperCanvasEl.addEventListener('contextmenu', handleCanvasContextMenu);

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
          canvas.upperCanvasEl.style.cursor = activeToolRef.current === 'pan'
            ? 'grab'
            : (activeToolRef.current === 'mark' || activeToolRef.current === 'eraser' ? 'none' : '');
        } else {
          canvas.upperCanvasEl.style.cursor = activeToolRef.current === 'pan'
            ? 'grab'
            : (activeToolRef.current === 'mark' || activeToolRef.current === 'eraser' ? 'none' : '');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      canvas.upperCanvasEl.removeEventListener('contextmenu', handleCanvasContextMenu);
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:up', handleMouseUp);
      canvas.upperCanvasEl.removeEventListener('mouseleave', hideEraserCursor);
      if (rightClickRestoreTimer) {
        window.clearTimeout(rightClickRestoreTimer);
      }
      if (fabricCanvas.current) {
        fabricCanvas.current.dispose();
        fabricCanvas.current = null;
      }
      if (alignmentHintTimerRef.current) {
        clearTimeout(alignmentHintTimerRef.current);
      }
      isSpacePanRef.current = false;
      canvas.off('after:render', drawMaskOverlay);
      hideEraserCursor();
      canvas.upperCanvasEl.style.cursor = '';
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Core Methods ---
  const setActiveObjectOrSelection = (objects) => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const targets = (objects || []).filter((obj) => obj && obj.id !== 'world-bounds');
    if (targets.length === 0) {
      canvas.discardActiveObject();
      return;
    }

    if (targets.length === 1) {
      canvas.discardActiveObject();
      canvas.setActiveObject(targets[0]);
      return;
    }

    if (typeof fabric.ActiveSelection === 'undefined') {
      canvas.discardActiveObject();
      canvas.setActiveObject(targets[0]);
      return;
    }

    const selection = new fabric.ActiveSelection(targets, { canvas });
    canvas.discardActiveObject();
    canvas.setActiveObject(selection);
  };

  const groupSelected = () => {
    const canvas = fabricCanvas.current;
    const activeSelection = canvas.getActiveObject();
    const activeObjects = (canvas.getActiveObjects ? canvas.getActiveObjects() : []).filter((obj) => obj.id !== 'world-bounds');
    if (!activeSelection || (!isActiveSelectionType(activeSelection) && activeObjects.length < 2)) {
      return;
    }

    const grouped = createGroupFromActiveObjects(canvas);
    if (!grouped) {
      return;
    }

    canvas.requestRenderAll();
    syncUI();
  };

  const ungroupSelected = () => {
    const canvas = fabricCanvas.current;
    const activeGroup = canvas.getActiveObject();
    if (!activeGroup || activeGroup.type !== 'group') return;
    expandGroupToSelection(activeGroup, canvas);
    canvas.requestRenderAll();
    syncUI();
  };

  const applyContextTargetAsActive = (target) => {
    const canvas = fabricCanvas.current;
    if (!canvas || !target) return;
    if (!canvas.getActiveObject) return;

    const activeObjects = (canvas.getActiveObjects ? canvas.getActiveObjects() : []);
    const alreadySelected = activeObjects.includes(target);
    if (!alreadySelected) {
      canvas.discardActiveObject();
      canvas.setActiveObject(target);
    }
  };

  const handleLayerRowClick = (event, target) => {
    const canvas = fabricCanvas.current;
    if (!canvas || !target || target.id === 'world-bounds') return;

    const isMultiSelect = event && (event.ctrlKey || event.metaKey || event.shiftKey);
    const activeObjects = (canvas.getActiveObjects ? canvas.getActiveObjects() : []).filter((obj) => obj.id !== 'world-bounds');
    const hasTarget = activeObjects.includes(target);

    if (!isMultiSelect) {
      if (activeObjects.length === 1 && activeObjects[0] === target) {
        return;
      }
      setActiveObjectOrSelection([target]);
    } else if (hasTarget) {
      setActiveObjectOrSelection(activeObjects.filter((obj) => obj !== target));
    } else {
      setActiveObjectOrSelection([...activeObjects, target]);
    }

    canvas.requestRenderAll();
    syncUI();
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextBringToFront = () => {
    const canvas = fabricCanvas.current;
    const target = contextMenu?.target;
      if (!canvas || !target || isWorldBoundsObject(target)) {
      closeContextMenu();
      return;
    }

    applyContextTargetAsActive(target);
    if (typeof canvas.bringObjectToFront === 'function') {
      canvas.bringObjectToFront(target);
    } else if (typeof target.bringToFront === 'function') {
      target.bringToFront();
    } else if (typeof canvas.bringToFront === 'function') {
      canvas.bringToFront(target);
    } else {
      const objects = canvas.getObjects();
      const targetIndex = objects.indexOf(target);
      if (targetIndex >= 0) {
        canvas.moveTo(target, objects.length - 1);
      }
    }
    canvas.requestRenderAll();
    syncUI();
    closeContextMenu();
  };

  const handleContextMoveForward = () => {
    const canvas = fabricCanvas.current;
    const target = contextMenu?.target;
    if (!canvas || !target || isWorldBoundsObject(target)) {
      closeContextMenu();
      return;
    }

    applyContextTargetAsActive(target);
    reorderLayer(target, 'up');
    syncUI();
    closeContextMenu();
  };

  const handleContextMoveBackward = () => {
    const canvas = fabricCanvas.current;
    const target = contextMenu?.target;
    if (!canvas || !target || isWorldBoundsObject(target)) {
      closeContextMenu();
      return;
    }

    applyContextTargetAsActive(target);
    reorderLayer(target, 'down');
    syncUI();
    closeContextMenu();
  };

  const handleContextSendToBack = () => {
    const canvas = fabricCanvas.current;
    const target = contextMenu?.target;
    if (!canvas || !target || isWorldBoundsObject(target)) {
      closeContextMenu();
      return;
    }

    applyContextTargetAsActive(target);
    if (typeof canvas.sendObjectToBack === 'function') {
      canvas.sendObjectToBack(target);
    } else if (typeof target.sendToBack === 'function') {
      target.sendToBack();
    } else if (typeof canvas.sendToBack === 'function') {
      canvas.sendToBack(target);
    } else if (typeof canvas.getObjects === 'function') {
      const objects = canvas.getObjects();
      const worldBoundsIndex = objects.findIndex((obj) => isWorldBoundsObject(obj));
      const targetBottomIndex = worldBoundsIndex >= 0 ? Math.min(worldBoundsIndex + 1, objects.length - 1) : 0;
      if (typeof canvas.moveTo === 'function') {
        canvas.moveTo(target, targetBottomIndex);
      } else {
        const activeObject = canvas.getActiveObject ? canvas.getActiveObject() : null;
        if (!activeObject && typeof canvas.setActiveObject === 'function') {
          canvas.setActiveObject(target);
        }
        target.moveTo && target.moveTo(targetBottomIndex);
      }
    }
    canvas.requestRenderAll();
    syncUI();
    closeContextMenu();
  };

  const handleContextGroup = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
      const activeCount = (canvas.getActiveObjects ? canvas.getActiveObjects() : []).filter((obj) => !isWorldBoundsObject(obj)).length;
    if (!active || !isActiveSelectionType(active) || activeCount < 2) {
      closeContextMenu();
      return;
    }

    const grouped = createGroupFromActiveObjects(canvas);
    if (!grouped) {
      closeContextMenu();
      return;
    }
    canvas.requestRenderAll();
    syncUI();
    closeContextMenu();
  };

  const handleContextUngroup = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'group') {
      closeContextMenu();
      return;
    }
    expandGroupToSelection(active, canvas);
    canvas.requestRenderAll();
    syncUI();
    closeContextMenu();
  };

  const generateObjectId = useCallback(() => {
    const now = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `obj-${now}-${random}`;
  }, []);

  const isWorldBoundsObject = useCallback((obj) => {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.id === 'world-bounds' || obj.name === 'world-bounds' || obj.isWorldBounds === true) {
      return true;
    }

    if (obj.type !== 'Rect') return false;

    const width = Number(obj.width);
    const height = Number(obj.height);
    const left = Number(obj.left);
    const top = Number(obj.top);
    const strokeWidth = Number(obj.strokeWidth || 0);
    const fill = obj.fill;
    const stroke = obj.stroke;

    const isCanvasSized = Math.abs(width - WORLD_CANVAS_WIDTH) < 0.001 && Math.abs(height - WORLD_CANVAS_HEIGHT) < 0.001;
    const isCentered = Math.abs(left - 0) < 0.001 && Math.abs(top - 0) < 0.001;
    const hasWorldOrigin = obj.originX === 'center' && obj.originY === 'center';
    const isTransparentFill = fill === null || fill === undefined || fill === 'transparent' || fill === 'rgba(255,255,255,0)';
    const isTransparentStroke = stroke === null || stroke === undefined || stroke === 'transparent' || Number.isNaN(strokeWidth) || strokeWidth === 0;
    return isCanvasSized && isCentered && hasWorldOrigin && isTransparentFill && isTransparentStroke;
  }, []);

  const ensureObjectId = useCallback((obj, usedIds = new Set()) => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.id === 'string' && obj.id.trim() !== '') {
      usedIds.add(obj.id);
      return obj.id;
    }

    let newId = generateObjectId();
    while (usedIds.has(newId)) {
      newId = generateObjectId();
    }
    usedIds.add(newId);
    obj.id = newId;
    return newId;
  }, [generateObjectId]);

  const buildProjectObjects = useCallback((objects) => {
    const usedIds = new Set();
    const filtered = [];
    (objects || []).forEach((obj) => {
      if (!obj || isWorldBoundsObject(obj)) return;
      const withId = ensureObjectId(obj, usedIds);
      if (!withId || withId === 'world-bounds') return;
      filtered.push(obj);
    });

    return {
      objects: filtered,
      usedIds,
    };
  }, [ensureObjectId, isWorldBoundsObject]);

  const PROJECT_FILE_VERSION = '2.0';

  const handleProjectNew = () => {
    setShowProjectMenu(false);
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const removableObjects = (canvas.getObjects ? canvas.getObjects() : []).filter((obj) => !isWorldBoundsObject(obj));
    removableObjects.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    ensureWorldBounds(canvas);
    canvas.requestRenderAll();

    setAiPrompt('');
    setShowAiInput(false);
    setSegmentTarget(null);
    setShowSegmentModal(false);
    setShowRemoveBgConfirm(false);
    clearMarks();
    syncUI();
  };

  const handleProjectSave = () => {
    setShowProjectMenu(false);
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const rawCanvasObjects = (canvas.getObjects ? canvas.getObjects() : []);
    const serializedObjects = rawCanvasObjects
      .filter((obj) => obj && !isWorldBoundsObject(obj))
      .map((obj) => obj.toObject(['id', 'name', 'originalWidth', 'originalHeight', 'isWorldBounds', 'mediaType', 'mediaSource']));
    const { objects: saveObjects } = buildProjectObjects(serializedObjects);

    const savedSettingsDraft = settingsDraft || {};
    const savedWorkflowMap = savedSettingsDraft.workflowMap || {};
    const projectSettings = {
      activeAiMode,
      activePanelTab,
      activeSettingsTab,
      showAlignmentHint,
      exportFormat,
      exportWidth,
      exportHeight,
      exportKeepAspect,
      exportAspectRatio,
      settingsDraft: {
        comfyui: String(savedSettingsDraft.comfyui || '').trim(),
        workflow: String(savedSettingsDraft.workflow || '').trim(),
        ocrModel: String(savedSettingsDraft.ocrModel || '').trim(),
        ollama: String(savedSettingsDraft.ollama || '').trim(),
        workflowMap: {
          t2i: String(savedWorkflowMap.t2i || '').trim(),
          i2i_single: String(savedWorkflowMap.i2i_single || '').trim(),
          i2i_multi: String(savedWorkflowMap.i2i_multi || '').trim(),
          upscale: String(savedWorkflowMap.upscale || '').trim(),
        },
      },
    };

    const projectData = {
      version: PROJECT_FILE_VERSION,
      savedAt: new Date().toISOString(),
      metadata: {
        canvasBg,
        showGrid,
        snapEnabled,
        zoom,
      },
      settings: projectSettings,
      viewport: {
        zoom: canvas.getZoom(),
        transform: canvas.viewportTransform ? [...canvas.viewportTransform] : null,
      },
      canvas: {
        version: canvas.version || '7.1.0',
        objects: saveObjects,
        background: canvas.backgroundColor || 'transparent',
      },
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `lovart-project-${Date.now()}.lvcproj`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleProjectLoad = () => {
    setShowProjectMenu(false);
    if (!projectFileInputRef.current) return;
    projectFileInputRef.current.value = '';
    projectFileInputRef.current.click();
  };

  const ensureWorldBounds = (canvas) => {
    if (!canvas) return;
    const existing = canvas.getObjects().find((obj) => isWorldBoundsObject(obj));
    if (existing) {
      existing.set({
        left: 0,
        top: 0,
        width: WORLD_CANVAS_WIDTH,
        height: WORLD_CANVAS_HEIGHT,
        id: 'world-bounds',
        name: 'world-bounds',
        isWorldBounds: true,
        fill: 'transparent',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        excludeFromExport: true,
        stroke: 'transparent',
        strokeWidth: 0,
        strokeUniform: false,
        visible: false,
      });
      if (typeof canvas.sendObjectToBack === 'function') {
        canvas.sendObjectToBack(existing);
      } else if (typeof existing.sendToBack === 'function') {
        existing.sendToBack();
      } else if (typeof canvas.sendToBack === 'function') {
        canvas.sendToBack(existing);
      } else if (typeof canvas.moveTo === 'function') {
        canvas.moveTo(existing, 0);
      }
      return;
    }

    const worldBounds = new fabric.Rect({
      left: 0,
      top: 0,
      width: WORLD_CANVAS_WIDTH,
      height: WORLD_CANVAS_HEIGHT,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      strokeUniform: false,
      visible: false,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      excludeFromExport: true,
      isWorldBounds: true,
      name: 'world-bounds',
      id: 'world-bounds',
    });
    canvas.add(worldBounds);
    if (typeof canvas.sendObjectToBack === 'function') {
      canvas.sendObjectToBack(worldBounds);
    } else if (typeof worldBounds.sendToBack === 'function') {
      worldBounds.sendToBack();
    } else if (typeof canvas.sendToBack === 'function') {
      canvas.sendToBack(worldBounds);
    } else if (typeof canvas.moveTo === 'function') {
      canvas.moveTo(worldBounds, 0);
    }
  };

  const restoreCanvasFromProject = async (projectData) => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;

    const rawCanvas = projectData?.canvas;
    const savedVersion = projectData?.version;
    if (savedVersion !== PROJECT_FILE_VERSION || !rawCanvas || typeof rawCanvas !== 'object' || !Array.isArray(rawCanvas.objects)) {
      throw new Error(`Invalid project format. Expected version ${PROJECT_FILE_VERSION}`);
    }

    const sanitizedObjects = buildProjectObjects((rawCanvas.objects || []).map((obj) => ({ ...obj })));
    const sanitized = {
      ...rawCanvas,
      objects: sanitizedObjects.objects,
    };

    await new Promise((resolve, reject) => {
      try {
        const loadResult = canvas.loadFromJSON(sanitized, resolve);
        if (loadResult?.then) {
          loadResult.then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });

    ensureWorldBounds(canvas);

    if (projectData?.metadata && typeof projectData.metadata === 'object') {
      if (typeof projectData.metadata.canvasBg === 'string') setCanvasBg(projectData.metadata.canvasBg);
      if (typeof projectData.metadata.showGrid === 'boolean') setShowGrid(projectData.metadata.showGrid);
      if (typeof projectData.metadata.snapEnabled === 'boolean') setSnapEnabled(projectData.metadata.snapEnabled);
      if (typeof projectData.metadata.zoom === 'number') setZoom(projectData.metadata.zoom);
    }

    const savedSettings = projectData?.settings;
    if (savedSettings && typeof savedSettings === 'object') {
      const validModes = ['t2i', 'i2i_single', 'i2i_multi'];
      const validPanelTabs = ['layers', 'properties', 'library'];
      const validSettingsTabs = ['comfyui', 'ollama'];
      if (typeof savedSettings.activeAiMode === 'string' && validModes.includes(savedSettings.activeAiMode)) {
        setActiveAiMode(savedSettings.activeAiMode);
      }
      if (typeof savedSettings.activePanelTab === 'string' && validPanelTabs.includes(savedSettings.activePanelTab)) {
        setActivePanelTab(savedSettings.activePanelTab);
      }
      if (typeof savedSettings.activeSettingsTab === 'string' && validSettingsTabs.includes(savedSettings.activeSettingsTab)) {
        setActiveSettingsTab(savedSettings.activeSettingsTab);
      }
      if (typeof savedSettings.showAlignmentHint === 'boolean') {
        setShowAlignmentHint(savedSettings.showAlignmentHint);
      }
      if (typeof savedSettings.exportFormat === 'string') setExportFormat(savedSettings.exportFormat);
      if (typeof savedSettings.exportWidth === 'string' || typeof savedSettings.exportWidth === 'number') setExportWidth(String(savedSettings.exportWidth));
      if (typeof savedSettings.exportHeight === 'string' || typeof savedSettings.exportHeight === 'number') setExportHeight(String(savedSettings.exportHeight));
      if (typeof savedSettings.exportKeepAspect === 'boolean') setExportKeepAspect(savedSettings.exportKeepAspect);
      if (typeof savedSettings.exportAspectRatio === 'number') setExportAspectRatio(savedSettings.exportAspectRatio);

      const savedSettingsDraft = savedSettings.settingsDraft;
      if (savedSettingsDraft && typeof savedSettingsDraft === 'object') {
        const rawMap = savedSettingsDraft.workflowMap;
        const safeMap = typeof rawMap === 'object' && rawMap !== null ? rawMap : {};
        setSettingsDraft((prev) => ({
          ...prev,
          comfyui: typeof savedSettingsDraft.comfyui === 'string' ? savedSettingsDraft.comfyui : prev.comfyui,
          workflow: typeof savedSettingsDraft.workflow === 'string' ? savedSettingsDraft.workflow : prev.workflow,
          ocrModel: typeof savedSettingsDraft.ocrModel === 'string' ? savedSettingsDraft.ocrModel : prev.ocrModel,
          ollama: typeof savedSettingsDraft.ollama === 'string' ? savedSettingsDraft.ollama : prev.ollama,
          workflowMap: {
            ...prev.workflowMap,
            t2i: typeof safeMap.t2i === 'string' ? safeMap.t2i : prev.workflowMap.t2i,
            i2i_single: typeof safeMap.i2i_single === 'string' ? safeMap.i2i_single : prev.workflowMap.i2i_single,
            i2i_multi: typeof safeMap.i2i_multi === 'string' ? safeMap.i2i_multi : prev.workflowMap.i2i_multi,
            upscale: typeof safeMap.upscale === 'string' ? safeMap.upscale : prev.workflowMap.upscale,
          },
        }));
      }
    }

    const viewportTransform = projectData?.viewport?.transform;
    const savedZoom = projectData?.viewport?.zoom;
    if (Array.isArray(viewportTransform) && viewportTransform.length === 6) {
      canvas.setViewportTransform([...viewportTransform]);
    } else if (typeof savedZoom === 'number') {
      canvas.setZoom(savedZoom);
    }

    canvas.requestRenderAll();
    syncArtboardPattern();
    syncUI();
    setSelectedObject(null);
    setRenamingId(null);
    setShowProjectMenu(false);
  };

  const handleProjectFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await restoreCanvasFromProject(parsed);
    } catch (error) {
      console.error('Failed to load project:', error);
      showNoticeModal('Project Error', 'Failed to load project file.');
    }
  };

  const handleContextRenameLayer = () => {
    const target = contextMenu?.target;
    if (!target || target.id === 'world-bounds') {
      closeContextMenu();
      return;
    }

    applyContextTargetAsActive(target);
    setRenamingId(target.id);
    closeContextMenu();
  };

  const handleContextRemoveLayer = () => {
    const canvas = fabricCanvas.current;
    const target = contextMenu?.target;
    if (!canvas || !target || target.id === 'world-bounds') {
      closeContextMenu();
      return;
    }

    canvas.remove(target);
    if (canvas.getActiveObject() === target) {
      canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
    syncUI();
    closeContextMenu();
  };

  const handleContextRemoveBg = async () => {
    const canvas = fabricCanvas.current;
    const target = contextMenu?.target;
    const isImageTarget = target && (target.type === 'FabricImage' || target.type === 'image');
    if (!canvas || !target || target.id === 'world-bounds' || !isImageTarget) {
      closeContextMenu();
      return;
    }

    applyContextTargetAsActive(target);
    setShowRemoveBgConfirm(true);
    closeContextMenu();
  };

  const getSelectedBounds = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return null;

    const activeObjects = canvas.getActiveObjects().filter((obj) => obj.id !== 'world-bounds');
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

  const exportSelectedArea = async () => {
    const resizeImageDataURL = (sourceDataURL, width, height, format, quality) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to initialize temporary canvas.'));
          return;
        }

        if (format === 'jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(tempCanvas.toDataURL(`image/${format}`, quality));
      };
      img.onerror = () => reject(new Error('Failed to resize export image.'));
      img.src = sourceDataURL;
    });

    const canvas = fabricCanvas.current;
    if (!canvas) return false;

    const selectedCount = canvas.getActiveObjects().length;
    if (selectedCount === 0) {
      setShowExportNoSelectionModal(true);
      return false;
    }

    const bounds = getSelectedBounds();
    if (!bounds) {
      showNoticeModal('Export Error', 'Could not determine selection bounds.');
      return false;
    }

    const selectedObjects = canvas.getActiveObjects().filter((obj) => obj.id !== 'world-bounds');
    if (!selectedObjects.length) {
      showNoticeModal('Export Error', 'Could not determine selectable objects for export.');
      return false;
    }

    const normalizedFormat = exportFormat === 'jpg' ? 'jpeg' : exportFormat;
    const ext = exportFormat === 'jpg' ? 'jpg' : exportFormat;
    const quality = normalizedFormat === 'png' ? 1 : 0.92;
    const activeObject = canvas.getActiveObject();
    const widthInput = Number.parseInt(exportWidth, 10);
    const heightInput = Number.parseInt(exportHeight, 10);
    const hasCustomSize = Number.isFinite(widthInput) && widthInput > 0 && Number.isFinite(heightInput) && heightInput > 0;
    let dataURL = null;

    const isActiveSelection = isActiveSelectionType(activeObject);

    if (isActiveSelection) {
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
      showNoticeModal('Export Error', 'Export failed to generate image data.');
      return false;
    }

    if (hasCustomSize) {
      try {
        dataURL = await resizeImageDataURL(dataURL, widthInput, heightInput, normalizedFormat, quality);
      } catch (err) {
        showNoticeModal('Export Error', 'Export failed while resizing to requested size.');
        return false;
      }
    }

    const link = document.createElement('a');
    const sizeSuffix = hasCustomSize ? `-${widthInput}x${heightInput}` : '';
    try {
      link.href = dataURL;
      link.download = `selection-export${sizeSuffix}.${ext}`;
      link.click();
    } catch (err) {
      showNoticeModal('Export Error', 'Export failed. Please try again.');
      return false;
    }

    return true;
  };

  const openExportOptions = () => {
    const bounds = getSelectedBounds();
    if (!bounds) {
      setShowExportNoSelectionModal(true);
      return;
    }

    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    setExportWidth(String(width));
    setExportHeight(String(height));
    setExportAspectRatio(height > 0 ? width / height : 1);
    setShowExportOptionsModal(true);
  };

  const updateExportWidth = (nextWidth) => {
    setExportWidth(nextWidth);
    if (!exportKeepAspect || !exportAspectRatio) return;
    const parsedWidth = Number.parseInt(nextWidth, 10);
    if (!Number.isFinite(parsedWidth) || parsedWidth <= 0) return;
    const nextHeight = Math.max(1, Math.round(parsedWidth / exportAspectRatio));
    setExportHeight(String(nextHeight));
  };

  const updateExportHeight = (nextHeight) => {
    setExportHeight(nextHeight);
    if (!exportKeepAspect || !exportAspectRatio) return;
    const parsedHeight = Number.parseInt(nextHeight, 10);
    if (!Number.isFinite(parsedHeight) || parsedHeight <= 0) return;
    const nextWidth = Math.max(1, Math.round(parsedHeight * exportAspectRatio));
    setExportWidth(String(nextWidth));
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
      width: 150, height: 150, rx: 0, ry: 0,
      fill: '#3b82f6',
      opacity: 0.5,
      stroke: 'transparent',
      strokeWidth: 0,
      strokeUniform: true,
    });
    canvas.add(rect);
    const sceneCenter = getCreationCenterInScene();
    rect.setPositionByOrigin(sceneCenter, 'center', 'center');
    rect.setCoords();
    canvas.setActiveObject(rect);
    canvas.requestRenderAll();
    syncUI();
  };

  const addCircle = () => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    const circle = new fabric.Circle({
      radius: 75,
      fill: '#3b82f6',
      opacity: 0.5,
      stroke: 'transparent',
      strokeWidth: 0
    });
    canvas.add(circle);
    const sceneCenter = getCreationCenterInScene();
    circle.setPositionByOrigin(sceneCenter, 'center', 'center');
    circle.setCoords();
    canvas.setActiveObject(circle);
    canvas.requestRenderAll();
    syncUI();
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
  };

  const placeObjectAtDropOrCenter = (canvas, obj, dropPoint) => {
    if (!canvas || !obj) return;
    if (dropPoint) {
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoomX = vpt[0] || 1;
      const zoomY = vpt[3] || zoomX;
      const sceneX = (dropPoint.x - vpt[4]) / zoomX;
      const sceneY = (dropPoint.y - vpt[5]) / zoomY;
      obj.setPositionByOrigin(new fabric.Point(sceneX, sceneY), 'center', 'center');
      obj.setCoords();
      return;
    }
    const sceneCenter = getCreationCenterInScene();
    obj.setPositionByOrigin(sceneCenter, 'center', 'center');
    obj.setCoords();
  };

  const createVideoPosterData = (file) => new Promise((resolve, reject) => {
    const mediaSource = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = mediaSource;
    let settled = false;

    const cleanup = () => {
      settled = true;
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
    };

    const captureFrame = () => {
      if (settled) return;
      try {
        const width = Math.max(1, video.videoWidth || 1);
        const height = Math.max(1, video.videoHeight || 1);
        const posterCanvas = document.createElement('canvas');
        posterCanvas.width = width;
        posterCanvas.height = height;
        const ctx = posterCanvas.getContext('2d');
        if (!ctx) throw new Error('Could not create video poster canvas.');
        ctx.drawImage(video, 0, 0, width, height);
        const posterDataUrl = posterCanvas.toDataURL('image/png');
        cleanup();
        resolve({ posterDataUrl, mediaSource });
      } catch (error) {
        cleanup();
        URL.revokeObjectURL(mediaSource);
        reject(error);
      }
    };

    video.onloadedmetadata = () => {
      if (settled) return;
      // Using a tiny seek offset avoids blank-first-frame posters on some codecs.
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTime = duration > 0.2 ? 0.12 : 0;
      try {
        if (seekTime > 0) {
          video.currentTime = Math.min(seekTime, Math.max(0, duration - 0.05));
          return;
        }
      } catch (_) {
        // If seek fails, fallback to immediate capture.
      }
      captureFrame();
    };

    video.onseeked = captureFrame;
    video.onloadeddata = captureFrame;

    video.onerror = () => {
      if (settled) return;
      cleanup();
      URL.revokeObjectURL(mediaSource);
      reject(new Error('Failed to decode video file.'));
    };
  });

  const addVideo = async (file, dropPoint = null) => {
    if (!file || !file.type.startsWith('video/')) return;
    try {
      const canvas = fabricCanvas.current;
      if (!canvas) return;
      const { posterDataUrl, mediaSource } = await createVideoPosterData(file);
      const poster = await loadFabricImage(posterDataUrl);
      poster.scaleToWidth(400);
      poster.name = file.name;
      poster.mediaType = 'video';
      poster.mediaSource = mediaSource;
      canvas.add(poster);
      placeObjectAtDropOrCenter(canvas, poster, dropPoint);
      canvas.setActiveObject(poster);
      setActiveTool('select');
      canvas.requestRenderAll();
    } catch (err) {
      console.error("Failed to load video:", err);
    }
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
        placeObjectAtDropOrCenter(canvas, img, dropPoint);

        canvas.setActiveObject(img);
        setActiveTool('select');
        canvas.requestRenderAll();
      } catch (err) {
        console.error("Failed to load image:", err);
      }
    };
    reader.readAsDataURL(file);
  };

  const addMedia = (file, dropPoint = null) => {
    if (!file) return;
    if (file.type.startsWith('image/')) {
      addImage(file, dropPoint);
      return;
    }
    if (file.type.startsWith('video/')) {
      addVideo(file, dropPoint);
    }
  };

  const setProperty = (prop, value) => {
    const canvas = fabricCanvas.current;
    const active = canvas.getActiveObject();
    if (!active) return;
    const oldFill = active.fill;
    if (prop === 'fill' && oldFill === value) return;

    if (prop === 'fontSize') {
      active.set({ fontSize: value, scaleX: 1, scaleY: 1 });
    } else {
      active.set(prop, value);
    }

    if (active.setCoords && prop !== 'fill') active.setCoords();
    canvas.requestRenderAll();

    if (prop === 'fill') {
      const nextFill = active.fill;
      if (nextFill !== oldFill) {
        setSelectedObject((prev) => (prev ? { ...prev, fill: nextFill } : prev));
      }
      syncUI();
      return;
    }

    syncUI();
  };

  const ensureHex = (color) => {
    if (!color || typeof color !== 'string') return '#3b82f6';
    if (color.startsWith('#')) return color;
    const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)/i);
    if (rgbaMatch) {
      const r = Math.max(0, Math.min(255, Number(rgbaMatch[1] || 0)));
      const g = Math.max(0, Math.min(255, Number(rgbaMatch[2] || 0)));
      const b = Math.max(0, Math.min(255, Number(rgbaMatch[3] || 0)));
      const toHex = (n) => n.toString(16).padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
    }
    return '#3b82f6';
  };

  const handleFillDraftInput = (value) => {
    const canvas = fabricCanvas.current;
    const active = canvas?.getActiveObject();
    if (!active) return;

    const objectId = active.id ?? null;
    const session = fillPreviewSessionRef.current;
    if (!session.active || session.objectId !== objectId) {
      session.active = true;
      session.objectId = objectId;
      session.startFill = active.fill;
    }

    isFillDraftingRef.current = true;
    fillDraftRef.current = value;
    suspendMaskOverlayUntilRef.current = performance.now() + 120;
    if (active.fill === value) return;
    active.set('fill', value);
    canvas.requestRenderAll();
  };

  const commitFillDraft = (explicitValue = null) => {
    const canvas = fabricCanvas.current;
    const active = canvas?.getActiveObject();
    const value = explicitValue || fillDraftRef.current;
    if (!value || !active) {
      isFillDraftingRef.current = false;
      fillPreviewSessionRef.current = { active: false, objectId: null, startFill: null };
      suspendMaskOverlayUntilRef.current = 0;
      return;
    }

    const session = fillPreviewSessionRef.current;
    const beforeFill = active.fill;
    const changedFromSession = session.active && session.startFill !== value;
    if (beforeFill !== value) {
      active.set('fill', value);
    }
    canvas.requestRenderAll();

    isFillDraftingRef.current = false;
    fillDraftRef.current = value;
    fillPreviewSessionRef.current = { active: false, objectId: session.objectId, startFill: null };
    suspendMaskOverlayUntilRef.current = 0;

    if (beforeFill !== value || changedFromSession) {
      setSelectedObject((prev) => (prev ? { ...prev, fill: value } : prev));
      syncUI();
    }
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
      setShowRemoveBgConfirm(false); // Close modal on success
    } catch (err) {
      console.error(err);
      showNoticeModal('AI Processing Error', 'AI Processing Error: ' + (err?.message || 'Unknown error.'));
    } finally {
      setIsAiProcessing(false);
    }
  };

  const showAiValidationModalMessage = (title, message) => {
    showNoticeModal(title || 'AI Generation Error', message || 'An error occurred while generating image.');
  };

  const getAiImageSelectionErrorMessage = (mode = 'i2i_single') => {
    const selectedMode = mode === 'i2i' ? 'i2i_single' : mode;
    if (selectedMode === 'i2i_multi') {
      return 'I2I (Multi) generation requires at least 2 image layers selected.';
    }
    if (selectedMode === 'upscale') {
      return 'Upscale generation requires an image layer selected.';
    }
    return 'I2I generation requires an image layer selected.';
  };

  const getAiSourceObjects = (mode = 'i2i_single') => {
    const canvas = fabricCanvas.current;
    if (!canvas?.getActiveObjects) return [];
    const imageObjects = canvas.getActiveObjects().filter((obj) => obj.type === 'FabricImage' || obj.type === 'image');
    const modeConfig = getAiModeConfig(mode);
    if (imageObjects.length < (modeConfig.minImageLayers || 0)) return [];
    return imageObjects;
  };

  const validateAiSourceSelection = (mode = 'i2i_single') => {
    const modeConfig = getAiModeConfig(mode);
    if ((modeConfig.minImageLayers || 0) <= 0) return true;
    const sourceObjects = getAiSourceObjects(modeConfig.key);
    if (sourceObjects.length < modeConfig.minImageLayers) {
      showAiValidationModalMessage('AI Generation Error', getAiImageSelectionErrorMessage(modeConfig.key));
      return false;
    }
    return true;
  };

  const collectAiSourceImageBlobs = async (mode = 'i2i_single') => {
    const modeConfig = getAiModeConfig(mode);
    if ((modeConfig.minImageLayers || 0) <= 0) return [];

    const sourceObjects = getAiSourceObjects(modeConfig.key);
    if (sourceObjects.length < modeConfig.minImageLayers) {
      throw new Error(getAiImageSelectionErrorMessage(modeConfig.key));
    }

    const blobs = [];
    for (const obj of sourceObjects) {
      const dataURL = obj.toDataURL({ format: 'png' });
      const blob = await (await fetch(dataURL)).blob();
      blobs.push(blob);
    }
    return blobs;
  };

  const generateAiImage = async (mode = 't2i') => {
    const modeConfig = getAiModeConfig(mode);
    if (modeConfig.promptRequired && !aiPrompt.trim()) {
      showAiValidationModalMessage('AI Generation Error', 'Prompt is required for this mode.');
      return;
    }
    const requiresImageSource = (modeConfig.minImageLayers || 0) > 0;
    const showAiError = (title, message) => {
      setAiValidationTitle(title || 'AI Generation Error');
      setAiValidationMessage(message || 'An error occurred while generating image.');
      setShowAiValidationModal(true);
    };

    setIsAiProcessing(true);
    try {
      if (aiPrompt.trim()) {
        savePromptToHistory(modeConfig.key, aiPrompt);
      }
      const formData = new FormData();
      formData.append('prompt', aiPrompt);

    if (requiresImageSource) {
      const blobs = await collectAiSourceImageBlobs(modeConfig.key);
      if (blobs.length < modeConfig.minImageLayers) {
        showAiError('AI Generation Error', getAiImageSelectionErrorMessage(modeConfig.key));
        return;
      }

      if (modeConfig.key === 'i2i_multi') {
        blobs.forEach((blob, index) => formData.append('source_images', blob, `source_${index + 1}.png`));
      } else {
        const [firstBlob] = blobs;
        if (!firstBlob) {
          throw new Error(getAiImageSelectionErrorMessage(modeConfig.key));
        }
        formData.append('source_image', firstBlob, 'source.png');
      }
    }

      if (requiresImageSource) {
        const canvas = fabricCanvas.current;
        if (!canvas) {
          showAiError('AI Generation Error', 'Canvas is not available.');
          return;
        }
      }

      const selectedWorkflow = settingsDraft.workflowMap?.[modeConfig.key] || (modeConfig.key === 't2i' ? settingsDraft.workflow : '');
      if (modeConfig.key !== 't2i' && !selectedWorkflow) {
        const displayMode = modeConfig.key === 'i2i_single'
          ? 'I2I (Single)'
          : modeConfig.key === 'i2i_multi'
            ? 'I2I (Multi)'
            : modeConfig.key === 'upscale'
              ? 'Upscale'
              : modeConfig.key.toUpperCase();
        throw new Error(`No workflow mapped for ${displayMode}. Select one in Settings > ComfyUI.`);
      }
      if (selectedWorkflow) formData.append('workflow', selectedWorkflow);
      formData.append('mode', modeConfig.key);

      const response = await fetch(`${API_BASE_URL}/generate-image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Generation failed' }));
        throw new Error(errorData?.detail || errorData?.message || 'Generation failed');
      }

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
      setShowAiInput(false);
      setAiPrompt('');
    } catch (err) {
      console.error(err);
      showNoticeModal('AI Generation Error', `AI Generation Error: ${err?.message || 'Unknown error.'}`);
    } finally {
      setIsAiProcessing(false);
    }
  };

  const segmentObject = async () => {
    const canvas = fabricCanvas.current;
    const strokes = maskStrokesRef.current || [];
    if (strokes.length === 0) {
      showNoticeModal('Segmentation', 'Use Mask Brush (M) to paint the target area first.');
      return;
    }

    let active = canvas.getActiveObject();

    // If no image is selected, infer target image from brush strokes
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) {
      const images = canvas.getObjects().filter(o => o.type === 'FabricImage' || o.type === 'image');
      let targetImage = null;

      if (maskTargetIdRef.current) {
        targetImage = images.find((img) => img.id === maskTargetIdRef.current);
      }
      if (!targetImage) {
        const firstStrokePoint = strokes[0]?.points?.[0];
        if (firstStrokePoint) {
          const firstPoint = new fabric.Point(firstStrokePoint.x, firstStrokePoint.y);
          targetImage = images.find((img) => img.containsPoint(firstPoint));
        }
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
        showNoticeModal('Segmentation', 'Please select the image you want to segment.');
        return;
      } else {
        showNoticeModal('Segmentation', 'Please add an image layer first.');
        return;
      }
    }

    // Capture the target and open modal
    setSegmentTarget(active);
    setShowSegmentModal(true);
  };

  const executeSegment = async (textPrompt) => {
    const canvas = fabricCanvas.current;
    const strokes = maskStrokesRef.current || [];
    if (strokes.length === 0) {
      showNoticeModal('Segmentation', 'Mask brush data not found. Paint the image and try again.');
      return;
    }

    const active = segmentTarget; // Use the captured target
    if (!active) return;

    setShowSegmentModal(false);
    setIsAiProcessing(true);
    try {
      // 1. Save original transformation
      const originalAngle = active.angle;
      const originalScaleX = active.scaleX;
      const originalScaleY = active.scaleY;

      // 2. Map brush strokes to local prompt points for SAM
      const matrix = active.calcTransformMatrix();
      const invertedMatrix = fabric.util.invertTransform(matrix);
      const offsetX = active.originX === 'left' ? 0 : active.width / 2;
      const offsetY = active.originY === 'top' ? 0 : active.height / 2;
      const width = Math.max(1, active.width || 1);
      const height = Math.max(1, active.height || 1);

      const flattenedPoints = strokes.flatMap((stroke) => (
        (stroke.points || []).map((pt) => ({
          x: pt.x,
          y: pt.y,
          size: stroke.size || maskBrushSizeRef.current || 1,
        }))
      ));
      const stride = Math.max(1, Math.ceil(flattenedPoints.length / 180));
      const sampledPoints = flattenedPoints.filter((_, idx) => idx % stride === 0);
      const avgBrushScene = sampledPoints.reduce((sum, p) => sum + (p.size || 1), 0) / Math.max(1, sampledPoints.length);
      const brushPaddingLocal = Math.max(2, avgBrushScene / Math.max(Math.abs(active.scaleX || 1), 0.0001));

      const localPoints = sampledPoints
        .map((p) => {
          const scenePoint = new fabric.Point(p.x, p.y);
          const localPt = fabric.util.transformPoint(scenePoint, invertedMatrix);
          return {
            x: localPt.x + offsetX,
            y: localPt.y + offsetY,
          };
        })
        .filter((p) => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height);

      if (localPoints.length === 0) {
        throw new Error('Mask does not overlap selected image.');
      }

      const MAX_PROMPT_POINTS = 96;
      const pointStride = Math.max(1, Math.ceil(localPoints.length / MAX_PROMPT_POINTS));
      const points = localPoints
        .filter((_, idx) => idx % pointStride === 0)
        .slice(0, MAX_PROMPT_POINTS)
        .map((p) => [Math.round(p.x), Math.round(p.y)]);
      const labels = points.map(() => 1);

      // 3. Export clean image (no scale/angle)
      active.set({ angle: 0, scaleX: 1, scaleY: 1 });
      const dataURL = active.toDataURL({ format: 'png' });

      // 4. Restore transforms immediately
      active.set({ angle: originalAngle, scaleX: originalScaleX, scaleY: originalScaleY });

      const blob = await (await fetch(dataURL)).blob();
      const formData = new FormData();
      formData.append('file', blob, 'image.png');
      formData.append('points', JSON.stringify(points));
      formData.append('labels', JSON.stringify(labels));
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

      clearMarks();
      syncUI();
    } catch (err) {
      console.error(err);
      showNoticeModal('AI Segmentation Error', 'AI Segmentation Error: ' + (err?.message || 'Unknown error.'));
    } finally {
      setIsAiProcessing(false);
    }
  };

  const convertToText = async () => {
    const canvas = fabricCanvas.current;
    const active = canvas.getActiveObject();
    if (!active || (active.type !== 'FabricImage' && active.type !== 'image')) {
      showNoticeModal('Text Conversion', 'Please select a segmented image layer (the text image) first.');
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
        showNoticeModal('Text Conversion', 'AI could not recognize any text in this image.');
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
    } catch (err) {
      console.error(err);
      showNoticeModal('Text Conversion Error', 'Text Conversion Error: ' + (err?.message || 'Unknown error.'));
    } finally {
      setIsAiProcessing(false);
    }
  };

  const openSelectedVideoPlayer = () => {
    const canvas = fabricCanvas.current;
    const active = canvas?.getActiveObject?.();
    if (!active) return;
    const isVideoImage =
      (active.type === 'FabricImage' || active.type === 'image') &&
      active.mediaType === 'video' &&
      typeof active.mediaSource === 'string' &&
      active.mediaSource.length > 0;
    if (!isVideoImage) return;

    setVideoPlayerTitle(active.name || 'Video');
    setVideoPlayerSource(active.mediaSource);
    setShowVideoPlayerModal(true);
  };

  const closeVideoPlayerModal = () => {
    setShowVideoPlayerModal(false);
    setVideoPlayerSource('');
    setVideoPlayerTitle('');
  };

  const applyImageFilter = (type, val) => {
    const canvas = fabricCanvas.current;
    const obj = canvas?.getActiveObject?.();
    const isImageObj = obj && (obj.type === 'FabricImage' || obj.type === 'image');
    if (!isImageObj) return;
    if (!Array.isArray(obj.filters)) obj.filters = [];

    if (type === 'grayscale') {
      if (val) obj.filters.push(new fabric.filters.Grayscale());
      else obj.filters = obj.filters.filter(f => f.type !== 'Grayscale');
    } else if (type === 'brightness') {
      const f = obj.filters.find(f => f.type === 'Brightness');
      if (f) f.brightness = val;
      else obj.filters.push(new fabric.filters.Brightness({ brightness: val }));
    }
    if (typeof obj.applyFilters === 'function') obj.applyFilters();
    canvas.renderAll();
    syncUI();
  };

  const clearMarks = () => {
    maskStrokesRef.current = [];
    setMaskStrokes([]);
    setMaskTargetId(null);
    setSegmentTarget(null);
    drawMaskOverlay();
  };

  // --- Layer Management ---
  const reorderLayer = (targetObj, direction) => {
    const canvas = fabricCanvas.current;
    if (!targetObj || !canvas) return;

    if (direction === 'up') {
      if (typeof canvas.bringObjectForward === 'function') {
        canvas.bringObjectForward(targetObj);
      } else if (typeof targetObj.bringForward === 'function') {
        targetObj.bringForward();
      } else if (typeof canvas.bringForward === 'function') {
        canvas.bringForward(targetObj);
      }
    } else {
      if (typeof canvas.sendObjectBackwards === 'function') {
        canvas.sendObjectBackwards(targetObj);
      } else if (typeof targetObj.sendBackwards === 'function') {
        targetObj.sendBackwards();
      } else if (typeof canvas.sendBackwards === 'function') {
        canvas.sendBackwards(targetObj);
      }
    }

    canvas.requestRenderAll();
    syncUI();
  };

  const moveLayerByDrag = (sourceIdx, targetIdx) => {
    const canvas = fabricCanvas.current;
    if (!canvas || sourceIdx == null || targetIdx == null || sourceIdx === targetIdx) return;

    const allCanvasObjects = canvas.getObjects();
    const orderedCanvasObjects = allCanvasObjects.filter(obj => obj.id !== 'world-bounds');

    if (sourceIdx < 0 || targetIdx < 0 || sourceIdx >= orderedCanvasObjects.length || targetIdx >= orderedCanvasObjects.length) return;

    const sourceObj = orderedCanvasObjects[sourceIdx];
    const targetObj = orderedCanvasObjects[targetIdx];
    if (!sourceObj || !targetObj || sourceObj === targetObj) return;

    const sourceCanvasIndex = allCanvasObjects.indexOf(sourceObj);
    const targetCanvasIndex = allCanvasObjects.indexOf(targetObj);
    if (sourceCanvasIndex === -1 || targetCanvasIndex === -1) return;

    let destinationIndex = targetCanvasIndex;
    if (sourceCanvasIndex < targetCanvasIndex) {
      destinationIndex -= 1;
    }
    if (destinationIndex < 0) destinationIndex = 0;

    if (typeof canvas.moveObjectTo === 'function') {
      canvas.moveObjectTo(sourceObj, destinationIndex);
    } else if (typeof canvas.moveTo === 'function') {
      canvas.moveTo(sourceObj, destinationIndex);
    } else if (typeof sourceObj.moveTo === 'function') {
      sourceObj.moveTo(destinationIndex);
    }

    if (selectedObject?.id === sourceObj.id) {
      canvas.setActiveObject(sourceObj);
    }

    canvas.requestRenderAll();
    syncUI();
  };

  const renameLayer = (id, newName) => {
    const canvas = fabricCanvas.current;
    const target = canvas.getObjects().find((o) => o.id === id);
    const nextName = (newName || '').trim();
    setRenamingId(null);

    if (!target || !nextName) return;

    target.name = nextName;
    if (selectedObject?.id === id) {
      setSelectedObject((prev) => (prev ? { ...prev, name: nextName } : prev));
    }
    canvas.requestRenderAll();
    syncUI();
  };

  const selectedIsText = selectedObject?.type === 'i-text' || selectedObject?.type === 'text';
  const selectedIsShape = selectedObject?.type === 'rect' || selectedObject?.type === 'circle' || selectedObject?.type === 'ellipse';
  const selectedIsImage = selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image';
  const selectedIsVideo = selectedIsImage && selectedObject?.mediaType === 'video' && !!selectedObject?.mediaSource;
  const hasMaskData = maskStrokes.length > 0;
  const maskPointCount = maskStrokes.reduce((sum, stroke) => sum + (stroke.points?.length || 0), 0);

  // --- HTML Sub-components ---
  const Sidebar = () => (
    <aside className="sidebar">
      <div className="sidebar-logo"><Sparkles size={28} color="var(--accent)" /></div>
      <button className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`} onClick={() => setActiveTool('pan')} title="Hand (H / Space)"><Hand size={22} /></button>
      <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')} title="Selection (V)"><MousePointer2 size={22} /></button>
      <button className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`} onClick={() => setActiveTool('eraser')} title="Pixel Eraser (E)"><Eraser size={20} /></button>
      <button className={`tool-btn ${activeTool === 'mark' ? 'active' : ''}`} onClick={() => setActiveTool('mark')} title="Mask Brush (M)"><Target size={22} /></button>
      <div className="sidebar-divider" />
      <button className="tool-btn" onClick={addRect} title="Rectangle (R)"><Square size={22} /></button>
      <button className="tool-btn" onClick={addCircle} title="Circle (O)"><Circle size={20} /></button>
      <button className="tool-btn" onClick={addText} title="Text (T)"><TypeIcon size={22} /></button>
      <label className="tool-btn" title="Image / Video (I)"><ImageIcon size={22} /><input ref={imageInputRef} type="file" hidden accept="image/*,video/*" onChange={(e) => addMedia(e.target.files[0])} /></label>
    </aside>
  );

  const Topbar = () => (
      <header className="topbar">
        <div className="topbar-left">
          <h2 className="brand-title">OPEN LOVART</h2>
          <div className="topbar-menu-wrap" ref={topbarMenuRef}>
            <button
              className="action-tag"
              onClick={() => setShowProjectMenu((prev) => !prev)}
            >
              <MoreHorizontal size={14} /> File
            </button>
            {showProjectMenu && (
              <div className="topbar-menu">
                <button type="button" className="topbar-menu-item" onClick={handleProjectNew}>New Project</button>
                <button type="button" className="topbar-menu-item" onClick={handleProjectSave}>Save Project</button>
                <button type="button" className="topbar-menu-item" onClick={handleProjectLoad}>Load Project</button>
              </div>
            )}
          </div>
        </div>
        <div className="topbar-actions">
            {aiModeConfig.map((mode) => (
              <button
                key={mode.key}
                className={`action-tag ${showAiInput && activeAiMode === mode.key ? 'active' : ''}`}
                onClick={() => {
                  if (showAiInput && activeAiMode === mode.key) {
                    setShowAiInput(false);
                    return;
                  }
                  if ((getAiModeConfig(mode.key).minImageLayers || 0) > 0) {
                    if (!validateAiSourceSelection(mode.key)) return;
                  }
                  setActiveAiMode(mode.key);
                  setShowAiInput(true);
                }}
              >
                <Sparkles size={14} /> {mode.label}
              </button>
            ))}
        </div>
        <div className="topbar-right">
          <button className="action-tag" onClick={() => { setActiveSettingsTab('comfyui'); setShowSettingsModal(true); }}>
            <Settings size={14} /> Settings
          </button>
          <button className="action-tag topbar-primary-action" onClick={openExportOptions}>
            <Download size={14} /> Export
          </button>
        </div>
      </header>
  );

  const canAlignNow = canAlignSelection();
  const promptHistoryItems = getPromptHistoryForMode(activeAiMode)
    .filter((item) => item.toLowerCase().includes(aiPrompt.trim().toLowerCase()));

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      <Sidebar />
      <Topbar />

      <input
        ref={projectFileInputRef}
        type="file"
        accept=".lvcproj,.json"
        hidden
        onChange={handleProjectFileChange}
      />

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
          if (files && files.length > 0) {
            const mediaFiles = Array.from(files).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
            if (mediaFiles.length === 0) return;

            const canvasRect = fabricCanvas.current?.upperCanvasEl?.getBoundingClientRect();
            const dropPoint = canvasRect
              ? { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top }
              : null;

            if (!dropPoint || mediaFiles.length === 1) {
              mediaFiles.forEach((file) => addMedia(file, dropPoint));
              return;
            }

            const cols = Math.ceil(Math.sqrt(mediaFiles.length));
            const rows = Math.ceil(mediaFiles.length / cols);
            const spacing = 64;

            mediaFiles.forEach((file, idx) => {
              const col = idx % cols;
              const row = Math.floor(idx / cols);
              const offsetX = (col - (cols - 1) / 2) * spacing;
              const offsetY = (row - (rows - 1) / 2) * spacing;
              addMedia(file, {
                x: dropPoint.x + offsetX,
                y: dropPoint.y + offsetY,
              });
            });
          }
        }}>
        <div className="canvas-shadow">
          <canvas ref={canvasRef} />
          <canvas ref={maskOverlayRef} className="mask-overlay-canvas" />
          <div
            ref={eraserCursorRef}
            className="eraser-cursor"
            style={{
              width: `${(activeTool === 'mark' ? maskBrushSize : eraserSize) * 2}px`,
              height: `${(activeTool === 'mark' ? maskBrushSize : eraserSize) * 2}px`,
              borderColor: activeTool === 'mark' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(59, 130, 246, 0.95)',
              boxShadow: activeTool === 'mark'
                ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(16, 185, 129, 0.2)'
                : 'inset 0 0 0 1px rgba(255, 255, 255, 0.9)',
              display: activeTool === 'eraser' || activeTool === 'mark' ? 'block' : 'none'
            }}
          />
        </div>
        {isDragging && <div className="drop-overlay">Drop images to upload</div>}

        {/* Floating Quick AI */}
        {hasMaskData && (
          <div className="quick-ai-panel">
            <div className="ai-counts">
              <span>Mask Ready</span>
              <span>{maskPointCount} samples</span>
            </div>
            <div className="v-div" />
            <button className="ai-action" onClick={segmentObject}>Segment</button>
            <button className="ai-action secondary" onClick={clearMarks}>Clear Mask</button>
          </div>
        )}
      </main>

      {showAiInput && (
        <div className="ai-prompt-overlay" ref={promptHistoryRef}>
          <div className="ai-prompt-container">
            <Sparkles size={20} className="ai-accent-icon" />
              <input
                autoFocus
                className="ai-prompt-input"
                placeholder={getAiModeConfig(activeAiMode).promptRequired ? "Describe the image you want to create..." : "Prompt (optional for Upscale)"}
                value={aiPrompt}
                onFocus={() => setShowPromptHistory(true)}
                onChange={(e) => {
                  setAiPrompt(e.target.value);
                  setShowPromptHistory(true);
                }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if ((getAiModeConfig(activeAiMode).minImageLayers || 0) > 0 && !validateAiSourceSelection(activeAiMode)) return;
                generateAiImage(activeAiMode);
              }}
            />
            <button
              type="button"
              className={`ai-history-btn ${showPromptHistory ? 'active' : ''}`}
              onClick={() => setShowPromptHistory((prev) => !prev)}
              title="Prompt history"
            >
              History
            </button>
            <button className="ai-gen-btn" onClick={() => {
                if ((getAiModeConfig(activeAiMode).minImageLayers || 0) > 0 && !validateAiSourceSelection(activeAiMode)) return;
                generateAiImage(activeAiMode);
            }} disabled={isAiProcessing}>
              {isAiProcessing ? 'Generating...' : 'Create'}
            </button>
          </div>
          {showPromptHistory && (
            <div className="ai-prompt-history">
              {promptHistoryItems.length === 0 ? (
                <div className="ai-prompt-history-empty">No saved prompts for this mode</div>
              ) : (
                promptHistoryItems.map((item, idx) => (
                  <div className="ai-prompt-history-item" key={`${item}-${idx}`}>
                    <button
                      type="button"
                      className="ai-prompt-history-use"
                      onClick={() => {
                        setAiPrompt(item);
                        setShowPromptHistory(false);
                      }}
                    >
                      {item}
                    </button>
                    <button
                      type="button"
                      className="ai-prompt-history-delete"
                      title="Delete prompt"
                      onClick={() => removePromptFromHistory(activeAiMode, item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Control Panel */}
      <aside className="control-panel">
        <div className="panel-tabs">
          <button className={`panel-tab ${activePanelTab === 'layers' ? 'active' : ''}`} onClick={() => setActivePanelTab('layers')}>Layers</button>
          <button className={`panel-tab ${activePanelTab === 'properties' ? 'active' : ''}`} onClick={() => setActivePanelTab('properties')}>Properties</button>                    
          <button className={`panel-tab ${activePanelTab === 'library' ? 'active' : ''}`} onClick={() => setActivePanelTab('library')}>Library</button>
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
                  <div className="prop-input-group">
                    <label>Size</label>
                    <div className="modern-input-group size-readonly-row" style={{ justifyContent: 'space-between' }}>
                      <span className="size-readonly-value">
                        {`${selectedObject.displayWidth || 0} x ${selectedObject.displayHeight || 0}`}
                      </span>
                      <span className="range-value-pill">Display</span>
                    </div>
                    {selectedIsImage && (
                      <div className="modern-input-group size-readonly-row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                        <span className="size-readonly-value">
                          {`${selectedObject.sourceWidth || 0} x ${selectedObject.sourceHeight || 0}`}
                        </span>
                        <span className="range-value-pill">Source</span>
                      </div>
                    )}
                  </div>
                  <div className="prop-input-group">
                    <label>Opacity</label>
                    <div className="modern-input-group slider-control">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedObject.opacity}
                        onChange={(e) => setProperty('opacity', parseFloat(e.target.value))}
                      />
                      <span className="range-value-pill">
                        {Math.round((selectedObject.opacity || 0) * 100)}%
                      </span>
                    </div>
                  </div>

                    {selectedIsText && (
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
                          <div className="modern-input-group font-size-control">
                            <button
                              className="input-step-btn font-size-step-btn"
                              onClick={() => setProperty('fontSize', Math.max(1, selectedObject.fontSize - 1))}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              className="font-size-input"
                              value={Math.round(selectedObject.fontSize)}
                              onChange={(e) => setProperty('fontSize', parseInt(e.target.value) || 1)}
                            />
                            <span className="font-size-unit">px</span>
                            <button
                              className="input-step-btn font-size-step-btn"
                              onClick={() => setProperty('fontSize', selectedObject.fontSize + 1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                        <div className="prop-input-group">
                        <label>Text Color</label>
                        <input
                          key={`text-fill-${selectedObject.id || 'none'}`}
                          type="color"
                          defaultValue={ensureHex(selectedObject.fill)}
                          onInput={(e) => handleFillDraftInput(e.target.value)}
                          onChange={() => {}}
                          onBlur={(e) => commitFillDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') {
                              commitFillDraft(e.target.value);
                            }
                          }}
                        />
                        </div>
                      <div className="flex-row">
                        <button className={`toggle-btn ${selectedObject.fontWeight === 'bold' ? 'active' : ''}`} onClick={() => setProperty('fontWeight', selectedObject.fontWeight === 'bold' ? 'normal' : 'bold')}><Bold size={16} /></button>
                        <button className={`toggle-btn ${selectedObject.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => setProperty('fontStyle', selectedObject.fontStyle === 'italic' ? 'normal' : 'italic')}><Italic size={16} /></button>
                      </div>
                    </div>
                  )}

                    {selectedIsShape && (
                      <div className="shape-tools">
                        <div className="prop-input-group">
                          <label>Fill Color</label>
                          <input
                            key={`shape-fill-${selectedObject.id || 'none'}`}
                            type="color"
                            defaultValue={ensureHex(selectedObject.fill)}
                            onInput={(e) => handleFillDraftInput(e.target.value)}
                            onChange={() => {}}
                              onBlur={(e) => commitFillDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  commitFillDraft(e.target.value);
                                }
                              }}
                            />
                        </div>
                        <div className="prop-input-group">
                          <label>Stroke Color</label>
                          <input
                            key={`shape-stroke-${selectedObject.id || 'none'}`}
                            type="color"
                            defaultValue={selectedObject.stroke && typeof selectedObject.stroke === 'string' && selectedObject.stroke.startsWith('#')
                              ? selectedObject.stroke
                              : '#18181b'}
                            onChange={(e) => setProperty('stroke', e.target.value)}
                          />
                          <button
                            className="action-tag"
                            onClick={() => {
                              setProperty('stroke', 'transparent');
                              setProperty('strokeWidth', 0);
                            }}
                          >
                            No Stroke
                          </button>
                        </div>
                        <div className="prop-input-group">
                          <label>Stroke Width</label>
                          <div className="modern-input-group font-size-control">
                            <button
                              className="input-step-btn font-size-step-btn"
                              onClick={() => setProperty('strokeWidth', Math.max(0, (selectedObject.strokeWidth || 0) - 1))}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              className="font-size-input"
                              min="0"
                              max="50"
                              value={selectedObject.strokeWidth || 0}
                              onChange={(e) => setProperty('strokeWidth', Math.max(0, parseInt(e.target.value) || 0))}
                            />
                            <span className="font-size-unit">px</span>
                            <button
                              className="input-step-btn font-size-step-btn"
                              onClick={() => setProperty('strokeWidth', (selectedObject.strokeWidth || 0) + 1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  {selectedIsImage && (
                    <div className="image-tools">
                      <div className="props-action-list">
                        {selectedIsVideo && (
                          <button
                            className="action-tag"
                            onClick={openSelectedVideoPlayer}
                          >
                            <Play size={14} /> Play Video
                          </button>
                        )}
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
                           <label>Eraser Size</label>
                          <div className="modern-input-group slider-control">
                            <input
                              type="range"
                              min="6"
                              max="140"
                              step="1"
                              value={eraserSize}
                              onChange={(e) => setEraserSize(parseInt(e.target.value, 10) || 28)}
                            />
                            <span className="range-value-pill">{eraserSize}px</span>
                          </div>
                        </div>
                      )}
                      {activeTool === 'mark' && (
                        <div className="prop-input-group">
                           <label>Mask Brush Size</label>
                          <div className="modern-input-group slider-control">
                            <input
                              type="range"
                              min="6"
                              max="180"
                              step="1"
                              value={maskBrushSize}
                              onChange={(e) => setMaskBrushSize(parseInt(e.target.value, 10) || 36)}
                            />
                            <span className="range-value-pill">{maskBrushSize}px</span>
                          </div>
                        </div>
                      )}
                      <div className="prop-input-group">
                        <label>Brightness</label>
                        <div className="modern-input-group slider-control">
                          <input
                            type="range"
                            min="-1"
                            max="1"
                            step="0.1"
                            value={selectedObject.brightness}
                            onChange={(e) => applyImageFilter('brightness', parseFloat(e.target.value))}
                          />
                          <span className="range-value-pill">
                            {(selectedObject.brightness || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="check-row">
                        <input type="checkbox" checked={selectedObject.grayscale} onChange={(e) => applyImageFilter('grayscale', e.target.checked)} />
                        <span>Grayscale</span>
                      </div>
                    </div>
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
                onClick={saveSelectedAssetToLibrary}
                disabled={isLibrarySaving || !(selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image')}
              >
                {isLibrarySaving ? 'Saving...' : 'Save Selected Asset'}
              </button>
            </div>
            {isLibraryLoading ? (
              <div className="no-selection-msg">Loading library...</div>
            ) : assetLibrary.length === 0 ? (
              <div className="no-selection-msg">No saved assets yet</div>
            ) : (
              <div className="library-grid">
                {assetLibrary.map((asset) => {
                  const isVideoAsset = String(asset?.content_type || '').toLowerCase().startsWith('video/');
                  const mediaLabel = isVideoAsset ? 'VIDEO' : 'IMAGE';
                  return (
                    <div
                      key={asset.id}
                      className="library-card"
                    >
                      <div className={`library-media-badge ${isVideoAsset ? 'video' : 'image'}`}>{mediaLabel}</div>
                      <button
                        className="library-insert-btn"
                        onClick={() => addAssetToCanvas(asset)}
                        title={getAssetDisplayName(asset.name)}
                      >
                        <div className="library-media-preview">
                          {isVideoAsset ? (
                            <video src={toAbsoluteAssetUrl(asset.url)} muted playsInline preload="metadata" />
                          ) : (
                            <img src={toAbsoluteAssetUrl(asset.url)} alt={getAssetDisplayName(asset.name)} loading="lazy" />
                          )}
                          {isVideoAsset && (
                            <div className="library-video-play-overlay">
                              <div
                                className="library-video-play-btn"
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setVideoPlayerTitle(getAssetDisplayName(asset.name) || 'Video');
                                  setVideoPlayerSource(toAbsoluteAssetUrl(asset.url));
                                  setShowVideoPlayerModal(true);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setVideoPlayerTitle(getAssetDisplayName(asset.name) || 'Video');
                                    setVideoPlayerSource(toAbsoluteAssetUrl(asset.url));
                                    setShowVideoPlayerModal(true);
                                  }
                                }}
                              >
                                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                                  <path d="M8 6v12l10-6z" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </div>
                        <span className="library-item-label">{`${mediaLabel} - ${getAssetDisplayName(asset.name)}`}</span>
                      </button>
                      <button
                        className="library-rename-btn"
                        title="Rename asset"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingAssetId(asset.id);
                          setEditingAssetName(getAssetDisplayName(asset.name));
                        }}
                      >
                        <Edit3 size={12} />
                      </button>
                    <button
                      className="library-delete-btn"
                      title="Delete asset"
                      onClick={() => setPendingDeleteAsset(asset)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )})}
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
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedLayerIndex(idx);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverIndex(idx);
                  }}
                  onDragEnd={() => {
                    setDraggedLayerIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveLayerByDrag(draggedLayerIndex, idx);
                    setDraggedLayerIndex(null);
                    setDragOverIndex(null);
                  }}
                  onClick={(e) => handleLayerRowClick(e, l.object)}
                >
                  <div className="l-order-btns">
                    <button onClick={(e) => { e.stopPropagation(); reorderLayer(l.object, 'up'); }}><ChevronUp size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); reorderLayer(l.object, 'down'); }}><ChevronDown size={12} /></button>
                  </div>
                  {renamingId === l.id ? (
                    <input
                      autoFocus
                      onBlur={(e) => renameLayer(l.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          renameLayer(l.id, e.target.value);
                          return;
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setRenamingId(null);
                        }
                      }}
                      defaultValue={l.name}
                      className="rename-input"
                    />
                  ) : (
                    <span onDoubleClick={() => setRenamingId(l.id)} className="l-name">{l.name}</span>
                  )}
                  <div className="l-actions">
                    <button title="Rename layer" onClick={(e) => { e.stopPropagation(); setRenamingId(l.id); }}><Edit3 size={14} /></button>
                    <button title={l.visible ? 'Hide layer' : 'Show layer'} onClick={(e) => { e.stopPropagation(); l.object.visible = !l.object.visible; fabricCanvas.current.requestRenderAll(); syncUI(); }}>{l.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                    <button title="Remove layer" onClick={(e) => { e.stopPropagation(); fabricCanvas.current.remove(l.object); }}><Trash2 size={14} /></button>
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
              <p>Manage ComfyUI and Ollama settings.</p>
            </div>

            {isSettingsLoading && (
              <div className="settings-loading-inline">
                <span className="settings-loading-spinner" aria-hidden="true" />
                Loading latest settings...
              </div>
            )}

            <div className="props-subtabs" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <button
                type="button"
                className={`props-subtab ${activeSettingsTab === 'comfyui' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('comfyui')}
                disabled={isSettingsSaving}
              >
                ComfyUI
              </button>
              <button
                type="button"
                className={`props-subtab ${activeSettingsTab === 'ollama' ? 'active' : ''}`}
                onClick={() => setActiveSettingsTab('ollama')}
                disabled={isSettingsSaving}
              >
                Ollama
              </button>
            </div>

            <div className="props-body">
              {activeSettingsTab === 'comfyui' ? (
                <>
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
                    <label>T2I Workflow</label>
                    <select
                      value={settingsDraft.workflowMap?.t2i || ''}
                      onChange={(e) =>
                        setSettingsDraft((prev) => ({
                          ...prev,
                          workflowMap: { ...prev.workflowMap, t2i: e.target.value },
                          workflow: prev.workflow,
                        }))
                      }
                      disabled={isSettingsSaving}
                    >
                      {settingsOptions.workflows.length === 0 && (
                        <option value={settingsDraft.workflowMap?.t2i || ''}>
                          {isSettingsLoading ? 'Loading workflows...' : 'No workflows available'}
                        </option>
                      )}
                      {settingsOptions.workflows.map((wf) => (
                        <option key={wf} value={wf}>{wf}</option>
                      ))}
                    </select>
                  </div>
                    <div className="prop-input-group">
                     <label>I2I (Single) Workflow</label>
                     <select
                       value={settingsDraft.workflowMap?.i2i_single || ''}
                       onChange={(e) =>
                         setSettingsDraft((prev) => ({
                           ...prev,
                           workflowMap: { ...prev.workflowMap, i2i_single: e.target.value },
                         }))
                       }
                       disabled={isSettingsSaving}
                    >
                      <option value="">{isSettingsLoading ? 'Loading workflows...' : 'No workflows selected'}</option>
                      {settingsOptions.workflows.map((wf) => (
                        <option key={wf} value={wf}>{wf}</option>
                      ))}
                    </select>
                  </div>
                    <div className="prop-input-group">
                      <label>I2I (Multi) Workflow</label>
                      <select
                        value={settingsDraft.workflowMap?.i2i_multi || ''}
                        onChange={(e) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            workflowMap: { ...prev.workflowMap, i2i_multi: e.target.value },
                          }))
                        }
                        disabled={isSettingsSaving}
                      >
                        <option value="">{isSettingsLoading ? 'Loading workflows...' : 'No workflows selected'}</option>
                        {settingsOptions.workflows.map((wf) => (
                          <option key={wf} value={wf}>{wf}</option>
                        ))}
                      </select>
                    </div>
                    <div className="prop-input-group">
                      <label>Upscale Workflow</label>
                    <select
                      value={settingsDraft.workflowMap?.upscale || ''}
                      onChange={(e) =>
                        setSettingsDraft((prev) => ({
                          ...prev,
                          workflowMap: { ...prev.workflowMap, upscale: e.target.value },
                        }))
                      }
                      disabled={isSettingsSaving}
                    >
                      <option value="">{isSettingsLoading ? 'Loading workflows...' : 'No workflows selected'}</option>
                      {settingsOptions.workflows.map((wf) => (
                        <option key={wf} value={wf}>{wf}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
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
                    <label>OCR Model</label>
                    <select
                      value={settingsDraft.ocrModel}
                      onChange={(e) => setSettingsDraft((prev) => ({ ...prev, ocrModel: e.target.value }))}
                      disabled={isSettingsSaving}
                    >
                      {settingsOptions.ocrModels.length === 0 && (
                        <option value={settingsDraft.ocrModel || ''}>
                          {isSettingsLoading ? 'Loading OCR models...' : 'No OCR models available'}
                        </option>
                      )}
                      {settingsOptions.ocrModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

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

      {showExportNoSelectionModal && (
        <div className="modal-overlay" onClick={() => setShowExportNoSelectionModal(false)}>
          <div className="confirm-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon-circle danger">
              <AlertTriangle size={28} />
            </div>
            <div className="modal-text">
              <h3>No Layer Selected</h3>
              <p>Select one or more layers first before exporting.</p>
            </div>
            <div className="modal-actions">
              <button className="modal-btn confirm danger" onClick={() => setShowExportNoSelectionModal(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showAiValidationModal && (
        <div className="modal-overlay" onClick={() => setShowAiValidationModal(false)}>
          <div className="confirm-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon-circle danger">
              <AlertTriangle size={28} />
            </div>
            <div className="modal-text">
              <h3>{aiValidationTitle}</h3>
              <p>{aiValidationMessage}</p>
            </div>
            <div className="modal-actions">
              <button className="modal-btn confirm danger" onClick={() => setShowAiValidationModal(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showVideoPlayerModal && videoPlayerSource && (
        <div className="modal-overlay" onClick={closeVideoPlayerModal}>
          <div
            className="confirm-modal"
            style={{ maxWidth: 860, width: 'min(92vw, 860px)', alignItems: 'stretch' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-text" style={{ textAlign: 'left' }}>
              <h3>{videoPlayerTitle || 'Video Preview'}</h3>
              <p>Video playback is available in modal preview.</p>
            </div>
            <video
              key={videoPlayerSource}
              src={videoPlayerSource}
              controls
              autoPlay
              playsInline
              style={{
                width: '100%',
                maxHeight: '70vh',
                borderRadius: 12,
                background: '#000',
                border: '1px solid rgba(148, 163, 184, 0.4)'
              }}
            />
            <div className="modal-actions">
              <button className="modal-btn confirm" onClick={closeVideoPlayerModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportOptionsModal && (
        <div className="modal-overlay" onClick={() => setShowExportOptionsModal(false)}>
          <div className="confirm-modal" style={{ maxWidth: 460, alignItems: 'stretch' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-text" style={{ textAlign: 'left' }}>
              <h3>Export Settings</h3>
              <p>Set output format and size. Leave both fields empty to use the current canvas size.</p>
            </div>
            <div className="props-body">
              <div className="prop-input-group">
                <label>Format</label>
                <select
                  className="export-format-select"
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                >
                  <option value="png">PNG</option>
                  <option value="jpg">JPG</option>
                  <option value="webp">WEBP</option>
                </select>
              </div>
                <div className="prop-input-group">
                  <label>Export Size (px)</label>
                  <div className="export-size-control-row">
                    <div className="export-size-control">
                      <input
                        className="export-size-input"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Width"
                        value={exportWidth}
                        onChange={(e) => updateExportWidth(e.target.value)}
                        aria-label="Export width"
                      />
                      <span className="export-size-hint">x</span>
                      <input
                        className="export-size-input"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Height"
                        value={exportHeight}
                        onChange={(e) => updateExportHeight(e.target.value)}
                        aria-label="Export height"
                      />
                    </div>
                    <button
                      type="button"
                      className={`export-aspect-toggle ${exportKeepAspect ? 'active' : ''}`}
                      onClick={() => setExportKeepAspect((v) => !v)}
                      aria-pressed={exportKeepAspect}
                      title={exportKeepAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                    >
                      {exportKeepAspect ? <Link2 size={12} /> : <Unlink2 size={12} />}
                      <span>Keep Ratio</span>
                    </button>
                  </div>
                  <span className="export-size-hint export-size-hint--muted">
                    Keep Ratio scales the other side automatically when one value changes.
                  </span>
                </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowExportOptionsModal(false)}>
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={async () => {
                  const ok = await exportSelectedArea();
                  if (ok) setShowExportOptionsModal(false);
                }}
              >
                Export
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
                This will remove <strong className="asset-name-break">{getAssetDisplayName(pendingDeleteAsset.name) || 'this asset'}</strong> from your library.
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

      {editingAssetId && (
        <div className="modal-overlay" onClick={() => !isRenamingAsset && setEditingAssetId(null)}>
          <div
            className="confirm-modal"
            style={{ maxWidth: 420, alignItems: 'stretch' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-text" style={{ textAlign: 'left' }}>
              <h3>Rename Asset</h3>
              <p>Enter a new display name for the selected asset.</p>
            </div>
            <div className="prop-input-group">
              <label>Asset Name</label>
              <input
                autoFocus
                className="library-rename-input"
                value={editingAssetName}
                onChange={(e) => setEditingAssetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renameAssetInLibrary(editingAssetId, editingAssetName);
                  }
                  if (e.key === 'Escape') {
                    setEditingAssetId(null);
                    setEditingAssetName('');
                  }
                }}
                disabled={isRenamingAsset}
                maxLength={120}
              />
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => {
                  setEditingAssetId(null);
                  setEditingAssetName('');
                }}
                disabled={isRenamingAsset}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={() => renameAssetInLibrary(editingAssetId, editingAssetName)}
                disabled={isRenamingAsset || !editingAssetName.trim()}
              >
                {isRenamingAsset ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Popup */}
      {
        contextMenu && contextMenu.target && contextMenu.target.id !== 'world-bounds' && (() => {
          const target = contextMenu.target;
          const targetType = target.type;
          const targetIsImage = targetType === 'FabricImage' || targetType === 'image';
          const activeObjects = (fabricCanvas.current?.getActiveObjects ? fabricCanvas.current.getActiveObjects() : []).filter((obj) => obj.id !== 'world-bounds');
          const canGroup = activeObjects.length >= 2;
          const canUngroup = targetType === 'group';

          return (
              <div className="floating-context" style={{ top: contextMenu.y, left: contextMenu.x }}>
              <div className="context-item" onClick={handleContextBringToFront}><ChevronUp size={14} /> Bring to Front</div>
              <div className="context-item" onClick={handleContextMoveForward}><ChevronUp size={14} /> Move Forward</div>
              <div className="context-item" onClick={handleContextSendToBack}><ChevronDown size={14} /> Send to Back</div>
              <div className="context-item" onClick={handleContextMoveBackward}><ChevronDown size={14} /> Move Backward</div>
              <div className={`context-item ${canGroup ? '' : 'disabled'}`} onClick={canGroup ? handleContextGroup : undefined} style={canGroup ? {} : { opacity: 0.45, pointerEvents: 'none' }}><Group size={14} /> Group</div>
              <div className={`context-item ${canUngroup ? '' : 'disabled'}`} onClick={canUngroup ? handleContextUngroup : undefined} style={canUngroup ? {} : { opacity: 0.45, pointerEvents: 'none' }}><Ungroup size={14} /> Ungroup</div>
              <div className="context-item" onClick={handleContextRenameLayer}><Edit3 size={14} /> Rename</div>
              <div className={`context-item ${targetIsImage ? '' : 'disabled'}`} onClick={targetIsImage ? handleContextRemoveBg : undefined} style={targetIsImage ? {} : { opacity: 0.45, pointerEvents: 'none' }}><Sparkles size={14} /> Remove Background</div>
              <div className="context-item red" onClick={handleContextRemoveLayer}><Trash2 size={14} /> Remove Layer</div>
            </div>
          );
        })()
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
              <p>AI will analyze the image and remove the background.</p>
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
              <p>Paint a mask with M, then optionally type what you want to extract.</p>
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
                {hasMaskData && (
                  <p className="mark-status">
                    <Target size={12} style={{ marginRight: 4 }} />
                    Brush mask ({maskPointCount} samples) will be used
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
                disabled={isAiProcessing || (!segmentText && !hasMaskData)}
              >
                {isAiProcessing ? 'Processing...' : 'Segment'}
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
  );
};

export default App;


