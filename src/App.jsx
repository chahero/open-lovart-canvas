import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, MousePointer2, Square, Type, Image as ImageIcon, Maximize,
  Layers as LayersIcon, Settings, Download, Trash2, Eye, EyeOff,
  MoreHorizontal, Sparkles, Scissors, Target, Edit3, RotateCcw,
  RotateCw, Undo2, Redo2, Grid, Search, Move, AlignLeft, AlignCenter,
  AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, Group, Ungroup, Bold, Italic, Type as TypeIcon,
  ChevronUp, ChevronDown
} from 'lucide-react';
import * as fabric from 'fabric';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WORLD_CANVAS_WIDTH = 5000;
const WORLD_CANVAS_HEIGHT = 5000;
const WORLD_CENTER_X = WORLD_CANVAS_WIDTH / 2;
const WORLD_CENTER_Y = WORLD_CANVAS_HEIGHT / 2;

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

  // --- Refs ---
  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);
  const canvasContainerRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const marksRef = useRef(marks);
  const isSavingHistory = useRef(false);
  const dragCounter = useRef(0);

  // --- Sync Refs ---
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { marksRef.current = marks; }, [marks]);

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
      backgroundColor: '#ffffff',
      width: canvasContainerRef.current?.clientWidth || 900,
      height: canvasContainerRef.current?.clientHeight || 650,
      preserveObjectStacking: true,
      stopContextMenu: true,
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

    const worldGridLine = 250;
    const worldBounds = new fabric.Rect({
      left: 0,
      top: 0,
      width: WORLD_CANVAS_WIDTH,
      height: WORLD_CANVAS_HEIGHT,
      fill: 'rgba(255,255,255,0)',
      stroke: '#252a33',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      id: 'world-bounds',
    });
    const guideLines = [];
    for (let i = 1; i < WORLD_CANVAS_WIDTH / worldGridLine; i += 1) {
      guideLines.push(
        new fabric.Line([i * worldGridLine, 0, i * worldGridLine, WORLD_CANVAS_HEIGHT], {
          stroke: 'rgba(42,46,55,0.25)',
          strokeWidth: 1,
          selectable: false,
          evented: false,
          id: 'world-bounds',
        })
      );
    }
    for (let i = 1; i < WORLD_CANVAS_HEIGHT / worldGridLine; i += 1) {
      guideLines.push(
        new fabric.Line([0, i * worldGridLine, WORLD_CANVAS_WIDTH, i * worldGridLine], {
          stroke: 'rgba(42,46,55,0.25)',
          strokeWidth: 1,
          selectable: false,
          evented: false,
          id: 'world-bounds',
        })
      );
    }
    canvas.add(worldBounds);
    guideLines.forEach((line) => {
      canvas.add(line);
      canvas.sendObjectToBack(line);
    });
    canvas.sendObjectToBack(worldBounds);

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

    canvas.on('object:added', () => { if (!isSavingHistory.current) saveHistory(); syncUI(); });
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
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    let isPanning = false;
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
      if (opt.e.altKey || activeToolRef.current === 'pan') {
        isPanning = true;
        canvas.selection = false;
        canvas.lastPosX = opt.e.clientX;
        canvas.lastPosY = opt.e.clientY;
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
        canvas.lastPosX = e.clientX;
        canvas.lastPosY = e.clientY;
      }
      handleMouseMove(opt); // Call the new handler
    });

    canvas.on('mouse:up', handleMouseUp); // Call the new handler

    // Keyboard Shortcuts
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const active = canvas.getActiveObject();
      if (e.ctrlKey && e.key === 'z') { undo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'y') { redo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'g') { groupSelected(); e.preventDefault(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'G') { ungroupSelected(); e.preventDefault(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = canvas.getActiveObjects();
        activeObjects.forEach(obj => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.renderAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    saveHistory();

    return () => {
      if (fabricCanvas.current) {
        fabricCanvas.current.dispose();
        fabricCanvas.current = null;
      }
      window.removeEventListener('keydown', handleKeyDown);
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

  const align = (type) => {
    const canvas = fabricCanvas.current;
    const active = canvas.getActiveObject();
    if (!active) return;
    const bound = active.getBoundingRect();
    const offsetX = active.left - bound.left;
    const offsetY = active.top - bound.top;

    switch (type) {
      case 'left': active.set('left', offsetX); break;
      case 'center-h': active.set('left', WORLD_CENTER_X - (bound.width / 2) + offsetX); break;
      case 'right': active.set('left', WORLD_CANVAS_WIDTH - bound.width + offsetX); break;
      case 'top': active.set('top', offsetY); break;
      case 'center-v': active.set('top', WORLD_CENTER_Y - (bound.height / 2) + offsetY); break;
      case 'bottom': active.set('top', WORLD_CANVAS_HEIGHT - bound.height + offsetY); break;
    }
    active.setCoords();
    canvas.renderAll();
    saveHistory();
  };

  const addRect = () => {
    const canvas = fabricCanvas.current;
    const rect = new fabric.Rect({
      width: 150, height: 150, rx: 12, ry: 12,
      fill: 'rgba(59, 130, 246, 0.5)', stroke: '#3b82f6', strokeWidth: 2
    });
    canvas.add(rect);
    canvas.centerObject(rect);
    canvas.setActiveObject(rect);
    syncUI();
    saveHistory();
  };

  const addText = () => {
    const canvas = fabricCanvas.current;
    const text = new fabric.IText('New Text Layer', {
      fontFamily: 'Inter', fontSize: 32, fill: '#18181b'
    });
    canvas.add(text);
    canvas.centerObject(text);
    canvas.setActiveObject(text);
    syncUI();
    saveHistory();
  };

  const addImage = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (f) => {
      try {
        const img = await fabric.FabricImage.fromURL(f.target.result);
        img.scaleToWidth(400);
        img.name = file.name;
        fabricCanvas.current.add(img);
        fabricCanvas.current.centerObject(img);
        fabricCanvas.current.setActiveObject(img);
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

      const img = await fabric.FabricImage.fromURL(resultURL);
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

      const img = await fabric.FabricImage.fromURL(url);
      img.scaleToWidth(512);
      fabricCanvas.current.add(img);
      fabricCanvas.current.centerObject(img);
      fabricCanvas.current.setActiveObject(img);

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

      const img = await fabric.FabricImage.fromURL(resultURL);
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
        originY: active.originY
      });

      // 4. Hide original image and add text
      active.set({ visible: false });
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

  // --- HTML Sub-components ---
  const Sidebar = () => (
    <aside className="sidebar">
      <div className="sidebar-logo"><Sparkles size={28} color="var(--accent)" /></div>
      <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')} title="Selection (V)"><MousePointer2 size={22} /></button>
      <button className={`tool-btn ${activeTool === 'mark' ? 'active' : ''}`} onClick={() => setActiveTool('mark')} title="Mark (M)"><Target size={22} /></button>
      <button className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`} onClick={() => setActiveTool('pan')} title="Pan (H)"><Move size={22} /></button>
      <div className="sidebar-divider" />
      <button className={`tool-btn ${showAiInput ? 'active' : ''}`} onClick={() => setShowAiInput(!showAiInput)} title="Magic Generate"><Sparkles size={22} /></button>
      <button className="tool-btn" onClick={addRect}><Square size={22} /></button>
      <button className="tool-btn" onClick={addText}><TypeIcon size={22} /></button>
      <div style={{ flexGrow: 1 }} />
      <label className="tool-btn" title="Image"><ImageIcon size={22} /><input type="file" hidden accept="image/*" onChange={(e) => addImage(e.target.files[0])} /></label>
      <button className="tool-btn" onClick={() => setShowGrid(!showGrid)}><Grid size={22} color={showGrid ? "var(--accent)" : "currentColor"} /></button>
      <button className="tool-btn"><Settings size={22} /></button>
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
        <button
          className="action-tag"
          onClick={() => setShowRemoveBgConfirm(true)}
          disabled={isAiProcessing || !(selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image')}
        >
          <Sparkles size={14} /> {isAiProcessing ? 'Removing...' : 'Remove Bg'}
        </button>
        <button className="action-tag"><Maximize size={14} /> Upscale</button>
        <button
          className="action-tag"
          onClick={segmentObject}
          disabled={isAiProcessing || !(selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image')}
        >
          <Scissors size={14} /> {isAiProcessing ? 'Segmenting...' : 'Segment'}
        </button>
        <button
          className="action-tag"
          onClick={convertToText}
          disabled={isAiProcessing || !(selectedObject?.type === 'FabricImage' || selectedObject?.type === 'image')}
        >
          <TypeIcon size={14} /> {isAiProcessing ? 'Converting...' : 'To Text'}
        </button>
        <button className="action-tag" onClick={groupSelected}><Group size={14} /> Group</button>
        <button className="action-tag" onClick={ungroupSelected}><Ungroup size={14} /> Ungroup</button>
      </div>
      <div className="topbar-right">
        <div className="zoom-info"><Search size={14} /> {Math.round(zoom * 100)}%</div>
        <button className="primary-btn"><Download size={16} /> Export</button>
      </div>
    </header>
  );

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      <Sidebar />
      <Topbar />

      {/* Main Artboard */}
      <main
        ref={canvasContainerRef}
        className={`artboard ${!showGrid ? 'no-grid' : ''} ${isDragging ? 'dragging' : ''}`}
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
            addImage(files[0]);
          }
        }}>
        <div className="canvas-shadow">
          <canvas ref={canvasRef} />
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
        <div className="cp-section">
          <h3 className="section-label">Alignment</h3>
          <div className="align-grid">
            <button onClick={() => align('left')}><AlignLeft size={18} /></button>
            <button onClick={() => align('center-h')}><AlignCenter size={18} /></button>
            <button onClick={() => align('right')}><AlignRight size={18} /></button>
            <button onClick={() => align('top')}><AlignVerticalJustifyStart size={18} /></button>
            <button onClick={() => align('center-v')}><AlignVerticalJustifyCenter size={18} /></button>
            <button onClick={() => align('bottom')}><AlignVerticalJustifyEnd size={18} /></button>
          </div>
        </div>

        <div className="cp-section">
          <h3 className="section-label">Properties</h3>
          {selectedObject ? (
            <div className="props-body">
              <div className="prop-input-group">
                <label>Opacity</label>
                <input type="range" min="0" max="1" step="0.01" value={selectedObject.opacity} onChange={(e) => setProperty('opacity', parseFloat(e.target.value))} />
              </div>

              {/* Text Controls */}
              {(selectedObject.type === 'i-text' || selectedObject.type === 'text') && (
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

              {/* Shape Controls (Rect) */}
              {selectedObject.type === 'rect' && (
                <div className="shape-tools">
                  <div className="prop-input-group">
                    <label>Fill Color</label>
                    <input type="color" value={ensureHex(selectedObject.fill)} onChange={(e) => setProperty('fill', e.target.value)} />
                  </div>
                </div>
              )}

              {/* Image Controls */}
              {(selectedObject.type === 'FabricImage' || selectedObject.type === 'image') && (
                <div className="image-tools">
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
            </div>
          ) : <div className="no-selection-msg">Select an object</div>}
        </div>

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
      </aside>

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
      </footer>

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
