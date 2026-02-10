import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  MousePointer2,
  Square,
  Type,
  Image as ImageIcon,
  Maximize,
  Layers as LayersIcon,
  Settings,
  Download,
  Trash2,
  Eye,
  EyeOff,
  MoreHorizontal,
  Sparkles,
  Scissors,
  Target,
  Edit3,
  RotateCcw,
  RotateCw,
  Undo2,
  Redo2,
  Grid,
  Search,
  Move
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
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(-1);

  // --- Refs ---
  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);
  const canvasContainerRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const marksRef = useRef(marks);
  const isSavingHistory = useRef(false);

  // --- Sync Refs ---
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { marksRef.current = marks; }, [marks]);

  // --- History (Undo/Redo) Logic ---
  const saveHistory = useCallback(() => {
    if (!fabricCanvas.current || isSavingHistory.current) return;

    const json = fabricCanvas.current.toJSON();
    const newHistory = history.slice(0, historyStep + 1);
    newHistory.push(JSON.stringify(json));

    // Limit history to 50 steps
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
    // Custom control styling for Fabric.js v7
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

    const updateUIState = () => {
      const objs = canvas.getObjects().map((obj, index) => ({
        id: obj.id || (obj.id = Math.random().toString(36).substr(2, 9)),
        name: obj.name || `${obj.type} ${index + 1}`,
        visible: obj.visible,
        active: obj === canvas.getActiveObject(),
        object: obj,
        type: obj.type
      })).reverse();
      setLayers(objs);

      const activeObj = canvas.getActiveObject();
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
          // Special for images
          brightness: activeObj.filters?.find(f => f.type === 'Brightness')?.brightness || 0,
          contrast: activeObj.filters?.find(f => f.type === 'Contrast')?.contrast || 0,
          grayscale: activeObj.filters?.some(f => f.type === 'Grayscale') || false,
        });
      } else {
        setSelectedObject(null);
      }
    };

    // Events
    canvas.on('object:added', () => { if (!isSavingHistory.current) saveHistory(); updateUIState(); });
    canvas.on('object:removed', () => { if (!isSavingHistory.current) saveHistory(); updateUIState(); });
    canvas.on('object:modified', () => { if (!isSavingHistory.current) saveHistory(); updateUIState(); });
    canvas.on('selection:created', updateUIState);
    canvas.on('selection:updated', updateUIState);
    canvas.on('selection:cleared', updateUIState);

    // Zoom Logic
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoomLevel = canvas.getZoom();
      zoomLevel *= 0.999 ** delta;
      if (zoomLevel > 20) zoomLevel = 20;
      if (zoomLevel < 0.1) zoomLevel = 0.1;
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoomLevel);
      setZoom(zoomLevel);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Panning Logic
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
        if (marksRef.current.length < 10) setMarks(prev => [...prev, newMark]);
        return;
      }

      if (opt.button === 3) { // Right Click
        if (opt.target) {
          canvas.setActiveObject(opt.target);
          setContextMenu({ x: opt.e.clientX, y: opt.e.clientY, target: opt.target });
        } else {
          setContextMenu(null);
        }
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

    canvas.on('mouse:up', () => {
      isPanning = false;
      canvas.selection = true;
    });

    // Keyboard Shortcuts
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const active = canvas.getActiveObject();

      if (e.ctrlKey && e.key === 'z') { undo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'y') { redo(); e.preventDefault(); }
      if (e.key === 'm') { setActiveTool('mark'); }
      if (e.key === 'v') { setActiveTool('select'); }
      if (e.key === 'h') { setActiveTool('pan'); }

      if (!active) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        canvas.remove(active);
        canvas.discardActiveObject().renderAll();
      }
      if (e.ctrlKey && e.key === 'c') {
        active.clone().then((cloned) => { canvas._clipboard = cloned; });
      }
      if (e.ctrlKey && e.key === 'v') {
        if (canvas._clipboard) {
          canvas._clipboard.clone().then((clonedObj) => {
            canvas.discardActiveObject();
            clonedObj.set({
              left: clonedObj.left + 10,
              top: clonedObj.top + 10,
              evented: true,
            });
            if (clonedObj instanceof fabric.ActiveSelection) {
              clonedObj.canvas = canvas;
              clonedObj.forEachObject((obj) => { canvas.add(obj); });
              clonedObj.setCoords();
            } else {
              canvas.add(clonedObj);
            }
            canvas._clipboard.top += 10;
            canvas._clipboard.left += 10;
            canvas.setActiveObject(clonedObj);
            canvas.requestRenderAll();
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Initial Save
    saveHistory();

    return () => {
      canvas.dispose();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // --- Tool Actions ---
  const addRect = () => {
    const rect = new fabric.Rect({
      left: 100, top: 100,
      fill: 'rgba(59, 130, 246, 0.5)',
      width: 150, height: 150,
      rx: 12, ry: 12,
      stroke: '#3b82f6', strokeWidth: 2
    });
    fabricCanvas.current.add(rect);
    fabricCanvas.current.setActiveObject(rect);
  };

  const addText = () => {
    const text = new fabric.IText('Double Click to Edit', {
      left: 150, top: 150,
      fontFamily: 'Inter', fontSize: 24, fill: '#18181b'
    });
    fabricCanvas.current.add(text);
    fabricCanvas.current.setActiveObject(text);
  };

  const addImageToCanvas = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (f) => {
      const img = await fabric.FabricImage.fromURL(f.target.result);
      img.scaleToWidth(400);
      img.name = file.name;
      fabricCanvas.current.add(img);
      fabricCanvas.current.centerObject(img);
      fabricCanvas.current.setActiveObject(img);
    };
    reader.readAsDataURL(file);
  };

  // --- Filter Management ---
  const applyFilter = (filterType, value) => {
    const active = fabricCanvas.current.getActiveObject();
    if (!active || active.type !== 'FabricImage' && active.type !== 'image') return;

    if (filterType === 'brightness') {
      const filter = new fabric.filters.Brightness({ brightness: value });
      const idx = active.filters.findIndex(f => f.type === 'Brightness');
      if (idx > -1) active.filters[idx] = filter;
      else active.filters.push(filter);
    } else if (filterType === 'contrast') {
      const filter = new fabric.filters.Contrast({ contrast: value });
      const idx = active.filters.findIndex(f => f.type === 'Contrast');
      if (idx > -1) active.filters[idx] = filter;
      else active.filters.push(filter);
    } else if (filterType === 'grayscale') {
      const idx = active.filters.findIndex(f => f.type === 'Grayscale');
      if (value) {
        if (idx === -1) active.filters.push(new fabric.filters.Grayscale());
      } else {
        if (idx > -1) active.filters.splice(idx, 1);
      }
    }

    active.applyFilters();
    fabricCanvas.current.renderAll();
    setSelectedObject(prev => ({ ...prev, [filterType]: value }));
  };

  const setProperty = (prop, value) => {
    const active = fabricCanvas.current.getActiveObject();
    if (!active) return;
    active.set(prop, value);
    fabricCanvas.current.renderAll();
    setSelectedObject({ ...selectedObject, [prop]: value });
  };

  // --- Handlers ---
  const handleFileUpload = (e) => { addImageToCanvas(e.target.files[0]); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) addImageToCanvas(files[0]);
  };

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Sparkles size={28} color="var(--accent)" />
        </div>
        <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')} title="Selection (V)">
          <MousePointer2 size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'mark' ? 'active' : ''}`} onClick={() => setActiveTool('mark')} title="Mark Mode (M)">
          <Target size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`} onClick={() => setActiveTool('pan')} title="Pan (H / Alt+Drag)">
          <Move size={22} />
        </button>
        <div className="sidebar-divider" />
        <button className="tool-btn" onClick={addRect} title="Add Rectangle">
          <Square size={22} />
        </button>
        <button className="tool-btn" onClick={addText} title="Add Text">
          <Type size={22} />
        </button>
        <div style={{ margin: 'auto' }} />
        <label className="tool-btn" title="Upload Image">
          <ImageIcon size={22} />
          <input type="file" hidden onChange={handleFileUpload} accept="image/*" />
        </label>
        <button className="tool-btn" onClick={() => setShowGrid(!showGrid)} title="Toggle Grid">
          <Grid size={22} color={showGrid ? "var(--accent)" : "currentColor"} />
        </button>
        <button className="tool-btn">
          <Settings size={22} />
        </button>
      </aside>

      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-left">
          <h2 className="brand-title">LOVART</h2>
          <div className="history-btns">
            <button className="history-btn" onClick={undo} disabled={historyStep <= 0}><Undo2 size={18} /></button>
            <button className="history-btn" onClick={redo} disabled={historyStep >= history.length - 1}><Redo2 size={18} /></button>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="action-btn"><Maximize size={15} /> Upscale</button>
          <button className="action-btn"><Scissors size={15} /> Remove bg</button>
          <button className="action-btn" onClick={() => setActiveTool('mark')}><Target size={15} /> Edit Elements</button>
          <button className="action-btn"><Type size={15} /> Edit Text</button>
        </div>

        <div className="topbar-right">
          <div className="zoom-indicator">
            <Search size={14} />
            <span>{Math.round(zoom * 100)}%</span>
            <button className="reset-zoom" onClick={() => { fabricCanvas.current.setZoom(1); setZoom(1); fabricCanvas.current.renderAll(); }}>Reset</button>
          </div>
          <button className="export-btn"><Download size={15} /> Export</button>
        </div>
      </header>

      {/* Main Canvas */}
      <main
        className={`canvas-container ${isDragging ? 'dragging' : ''} ${!showGrid ? 'no-grid' : ''}`}
        ref={canvasContainerRef}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} />
          {marks.map((mark, index) => (
            <div key={mark.id} className="mark-tag" style={{
              left: fabricCanvas.current ? (mark.x * fabricCanvas.current.getZoom()) + fabricCanvas.current.viewportTransform[4] : mark.x,
              top: fabricCanvas.current ? (mark.y * fabricCanvas.current.getZoom()) + fabricCanvas.current.viewportTransform[5] : mark.y
            }}>{index + 1}</div>
          ))}
        </div>

        {marks.length > 0 && (
          <div className="quick-edit-floating">
            <div className="mark-info">
              <div className="mark-badge">{marks.length}</div>
              <span>Elements Marked</span>
            </div>
            <div className="quick-edit-divider" />
            <button className="quick-edit-btn" onClick={() => alert('AI Segmenting...')}>
              <Scissors size={14} /> Split Layer
            </button>
            <button className="quick-edit-btn" onClick={() => setMarks([])}>
              <Trash2 size={14} /> Clear
            </button>
          </div>
        )}
      </main>

      {/* Properties Panel */}
      <aside className="properties-panel">
        <div className="panel-section">
          <h3 className="section-title">Selection Properties</h3>
          {selectedObject ? (
            <div className="props-list">
              <div className="prop-row">
                <span className="prop-label">Opacity</span>
                <input type="range" min="0" max="1" step="0.01" value={selectedObject.opacity} onChange={(e) => setProperty('opacity', parseFloat(e.target.value))} />
              </div>
              <div className="prop-row">
                <span className="prop-label">Rotation</span>
                <div className="rot-btns">
                  <button className="icon-btn" onClick={() => setProperty('angle', (selectedObject.angle - 90) % 360)}><RotateCcw size={16} /></button>
                  <button className="icon-btn" onClick={() => setProperty('angle', (selectedObject.angle + 90) % 360)}><RotateCw size={16} /></button>
                </div>
              </div>

              {(selectedObject.type === 'FabricImage' || selectedObject.type === 'image') && (
                <div className="filters-section">
                  <h4 className="sub-title">Image Filters</h4>
                  <div className="prop-row">
                    <span className="prop-label">Brightness</span>
                    <input type="range" min="-1" max="1" step="0.05" value={selectedObject.brightness} onChange={(e) => applyFilter('brightness', parseFloat(e.target.value))} />
                  </div>
                  <div className="prop-row">
                    <span className="prop-label">Contrast</span>
                    <input type="range" min="-1" max="1" step="0.05" value={selectedObject.contrast} onChange={(e) => applyFilter('contrast', parseFloat(e.target.value))} />
                  </div>
                  <div className="prop-row">
                    <span className="prop-label">Grayscale</span>
                    <input type="checkbox" checked={selectedObject.grayscale} onChange={(e) => applyFilter('grayscale', e.target.checked)} />
                  </div>
                </div>
              )}
            </div>
          ) : <div className="no-selection">Select an object to edit</div>}
        </div>

        <div className="panel-section" style={{ flexGrow: 1 }}>
          <h3 className="section-title">Layers</h3>
          <div className="layers-container">
            {layers.map((layer) => (
              <div key={layer.id} className={`layer-card ${layer.active ? 'active' : ''}`} onClick={() => fabricCanvas.current.setActiveObject(layer.object)}>
                <div className="layer-icon">
                  {layer.type === 'i-text' ? <Type size={14} /> : layer.type === 'FabricImage' ? <ImageIcon size={14} /> : <Square size={14} />}
                </div>
                <span className="layer-name">{layer.name}</span>
                <button className="visibility-btn" onClick={(e) => {
                  e.stopPropagation();
                  layer.object.visible = !layer.object.visible;
                  fabricCanvas.current.renderAll();
                  setHistoryStep(historyStep); // Trigger UI sync
                }}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Context Menu */}
      {contextMenu && (
        <div className="floating-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="menu-action" onClick={() => { fabricCanvas.current.remove(contextMenu.target); setContextMenu(null); }}>
            <Trash2 size={14} /> Delete
          </div>
        </div>
      )}

      {/* Status Bar */}
      <footer className="footer">
        <div className="status-item">{Math.round(zoom * 100)}%</div>
        <div className="status-item">900x650 PX</div>
        <div className="status-item">LOVART Professional</div>
      </footer>
    </div>
  );
};

export default App;
