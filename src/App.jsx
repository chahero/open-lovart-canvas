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

const App = () => {
  // --- States ---
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [marks, setMarks] = useState([]);
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

    const objs = canvas.getObjects().map((obj, index) => ({
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
        fontSize: activeObj.fontSize || 20,
        brightness: activeObj.filters?.find(f => f.type === 'Brightness')?.brightness || 0,
        contrast: activeObj.filters?.find(f => f.type === 'Contrast')?.contrast || 0,
        grayscale: activeObj.filters?.some(f => f.type === 'Grayscale') || false,
      });
    } else {
      setSelectedObject(null);
    }
  }, [layers]); // Add layers as dependency if needed, or keep it as is

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
      width: 900,
      height: 650,
      preserveObjectStacking: true,
      stopContextMenu: true,
    });

    fabricCanvas.current = canvas;

    // --- Snapping Logic ---
    const SNAP_THRESHOLD = 10;
    canvas.on('object:moving', (e) => {
      const obj = e.target;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
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
    canvas.on('mouse:down', (opt) => {
      if (opt.e.altKey || activeToolRef.current === 'pan') {
        isPanning = true;
        canvas.selection = false;
        canvas.lastPosX = opt.e.clientX;
        canvas.lastPosY = opt.e.clientY;
      }
      if (activeToolRef.current === 'mark') {
        const pointer = canvas.getPointer(opt.e);
        const newMark = { id: Date.now(), x: pointer.x, y: pointer.y };
        setMarks(prev => [...prev, newMark]);
        return;
      }
      if (opt.button === 3 && opt.target) {
        canvas.setActiveObject(opt.target);
        setContextMenu({ x: opt.e.clientX, y: opt.e.clientY, target: opt.target });
      } else {
        setContextMenu(null);
      }
    });

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
    });

    canvas.on('mouse:up', () => { isPanning = false; canvas.selection = true; });

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
        canvas.discardActiveObject().renderAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    saveHistory();

    return () => {
      canvas.dispose();
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
      case 'center-h': active.set('left', (canvas.width / 2) - (bound.width / 2) + offsetX); break;
      case 'right': active.set('left', canvas.width - bound.width + offsetX); break;
      case 'top': active.set('top', offsetY); break;
      case 'center-v': active.set('top', (canvas.height / 2) - (bound.height / 2) + offsetY); break;
      case 'bottom': active.set('top', canvas.height - bound.height + offsetY); break;
    }
    active.setCoords();
    canvas.renderAll();
    saveHistory();
  };

  const addRect = () => {
    const rect = new fabric.Rect({
      left: 100, top: 100, width: 150, height: 150, rx: 12, ry: 12,
      fill: 'rgba(59, 130, 246, 0.5)', stroke: '#3b82f6', strokeWidth: 2
    });
    fabricCanvas.current.add(rect);
    fabricCanvas.current.setActiveObject(rect);
  };

  const addText = () => {
    const text = new fabric.IText('New Text Layer', {
      left: 150, top: 150, fontFamily: 'Inter', fontSize: 32, fill: '#18181b'
    });
    fabricCanvas.current.add(text);
    fabricCanvas.current.setActiveObject(text);
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
    active.set(prop, value);
    canvas.renderAll();
    saveHistory();
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
    saveHistory();
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
        <button className="action-tag"><Maximize size={14} /> Upscale</button>
        <button className="action-tag"><Scissors size={14} /> Segment</button>
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
      <main className={`artboard ${!showGrid ? 'no-grid' : ''} ${isDragging ? 'dragging' : ''}`}
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
            <div key={m.id} className="mark-badge-canvas" style={{
              left: (m.x * fabricCanvas.current.getZoom()) + fabricCanvas.current.viewportTransform[4],
              top: (m.y * fabricCanvas.current.getZoom()) + fabricCanvas.current.viewportTransform[5]
            }}>{i + 1}</div>
          ))}
        </div>
        {isDragging && <div className="drop-overlay">Drop images to upload</div>}

        {/* Floating Quick AI */}
        {marks.length > 0 && (
          <div className="quick-ai-panel">
            <div className="ai-counts"><span>{marks.length}</span> Objects</div>
            <div className="v-div" />
            <button className="ai-action" onClick={() => alert('Extracting...')}>Split Layer</button>
            <button className="ai-action secondary" onClick={() => setMarks([])}>Clear</button>
          </div>
        )}
      </main>

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
                      <option>Inter</option><option>Roboto</option><option>Georgia</option><option>Monospace</option>
                    </select>
                  </div>
                  <div className="flex-row">
                    <button className={`toggle-btn ${selectedObject.fontWeight === 'bold' ? 'active' : ''}`} onClick={() => setProperty('fontWeight', selectedObject.fontWeight === 'bold' ? 'normal' : 'bold')}><Bold size={16} /></button>
                    <button className={`toggle-btn ${selectedObject.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => setProperty('fontStyle', selectedObject.fontStyle === 'italic' ? 'normal' : 'italic')}><Italic size={16} /></button>
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
    </div >
  );
};

export default App;
