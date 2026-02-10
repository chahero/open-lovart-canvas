import React, { useState, useEffect, useRef } from 'react';
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
  ChevronUp,
  ChevronDown,
  RotateCcw,
  RotateCw,
  Minus
} from 'lucide-react';
import * as fabric from 'fabric';
import './App.css';

const App = () => {
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [marks, setMarks] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);
  const canvasContainerRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const marksRef = useRef(marks);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);

  useEffect(() => {
    console.log('App component mounted');

    try {
      // Styling
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
        setSelectedObject(activeObj ? {
          type: activeObj.type,
          fill: activeObj.fill,
          opacity: activeObj.opacity,
          left: Math.round(activeObj.left),
          top: Math.round(activeObj.top),
          scaleX: activeObj.scaleX,
          scaleY: activeObj.scaleY,
          angle: activeObj.angle,
          id: activeObj.id
        } : null);
      };

      canvas.on('object:added', updateUIState);
      canvas.on('object:removed', updateUIState);
      canvas.on('object:modified', updateUIState);
      canvas.on('selection:created', updateUIState);
      canvas.on('selection:updated', updateUIState);
      canvas.on('selection:cleared', updateUIState);

      const handleKeyDown = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const active = canvas.getActiveObject();
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

      canvas.on('mouse:down', (opt) => {
        if (activeToolRef.current === 'mark') {
          const pointer = canvas.getPointer(opt.e);
          const newMark = { id: Date.now(), x: pointer.x, y: pointer.y };
          if (marksRef.current.length < 10) {
            setMarks(prev => [...prev, newMark]);
          }
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

      return () => {
        canvas.dispose();
        window.removeEventListener('keydown', handleKeyDown);
      };
    } catch (err) {
      console.error('Initial error:', err);
      setError(err.message);
    }
  }, []);

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

  const handleFileUpload = (e) => { addImageToCanvas(e.target.files[0]); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) addImageToCanvas(files[0]);
  };

  const setProperty = (prop, value) => {
    const active = fabricCanvas.current.getActiveObject();
    if (!active) return;
    active.set(prop, value);
    fabricCanvas.current.renderAll();
    setSelectedObject({ ...selectedObject, [prop]: value });
  };

  const moveUp = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (active) fabricCanvas.current.bringForward(active);
  };
  const moveDown = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (active) fabricCanvas.current.sendBackwards(active);
  };

  if (error) {
    return (
      <div style={{ padding: '40px', color: 'white', background: '#0a0a0c', height: '100vh' }}>
        <h1 style={{ color: '#ef4444' }}>Critical Error</h1>
        <pre style={{ background: '#1c1c21', padding: '20px', borderRadius: '10px' }}>{error}</pre>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: '#3b82f6', border: 'none', color: 'white', borderRadius: '5px' }}>Reload</button>
      </div>
    );
  }

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo" style={{ color: 'var(--accent)', marginBottom: '20px' }}>
          <Sparkles size={28} />
        </div>
        <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')}>
          <MousePointer2 size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'mark' ? 'active' : ''}`} onClick={() => setActiveTool('mark')}>
          <Target size={22} />
        </button>
        <button className="tool-btn" onClick={addRect} title="Add Rectangle">
          <Square size={22} />
        </button>
        <button className="tool-btn" onClick={addText} title="Add Text">
          <Type size={22} />
        </button>
        <div style={{ margin: 'auto' }} />
        <label className="tool-btn">
          <ImageIcon size={22} />
          <input type="file" hidden onChange={handleFileUpload} accept="image/*" />
        </label>
        <button className="tool-btn">
          <Settings size={22} />
        </button>
      </aside>

      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-left">
          <h2 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.5px' }}>LOVART</h2>
        </div>
        <div className="topbar-actions">
          <button className="action-btn"><Maximize size={15} /> Upscale</button>
          <button className="action-btn"><Scissors size={15} /> Remove bg</button>
          <button className="action-btn"><Target size={15} /> Edit Elements</button>
          <button className="action-btn"><Type size={15} /> Edit Text</button>
        </div>
        <div className="topbar-right">
          <button className="action-btn" style={{ background: 'var(--accent)', color: 'white' }}><Download size={15} /> Export</button>
        </div>
      </header>

      {/* Main Canvas */}
      <main
        className={`canvas-container ${isDragging ? 'dragging' : ''}`}
        ref={canvasContainerRef}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="canvas-wrapper" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} />
          {marks.map((mark, index) => (
            <div key={mark.id} className="mark-tag" style={{
              left: fabricCanvas.current ? mark.x * fabricCanvas.current.getZoom() : mark.x,
              top: fabricCanvas.current ? mark.y * fabricCanvas.current.getZoom() : mark.y
            }}>{index + 1}</div>
          ))}
        </div>

        {marks.length > 0 && (
          <div className="quick-edit-floating">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="mark-number" style={{ width: '22px', height: '22px' }}>{marks.length}</div>
              <span style={{ fontSize: '13px', fontWeight: '600' }}>Elements Marked</span>
            </div>
            <div className="quick-edit-divider"></div>
            <button className="quick-edit-btn" onClick={() => alert('AI Segmenting...')}>
              <Scissors size={14} /> Split Layer
            </button>
            <button className="quick-edit-btn" onClick={() => setMarks([])}>
              <Trash2 size={14} /> Clear
            </button>
          </div>
        )}
      </main>

      {/* Properties & Layers */}
      <aside className="properties-panel">
        <div className="property-group">
          <h3 className="panel-title">Active Marks</h3>
          {marks.length > 0 ? (
            <div className="marks-list">
              {marks.map((mark, index) => (
                <div key={mark.id} className="mark-list-item">
                  <div className="mark-number">{index + 1}</div>
                  <span style={{ fontSize: '12px' }}>Pos: {Math.round(mark.x)}, {Math.round(mark.y)}</span>
                  <button className="layer-btn" style={{ marginLeft: 'auto' }} onClick={() => setMarks(marks.filter(m => m.id !== mark.id))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Use Mark Mode (M)</p>}
        </div>

        <div className="property-group">
          <h3 className="panel-title">Layers</h3>
          <div className="layers-list">
            {layers.map((layer) => (
              <div key={layer.id} className={`layer-item ${layer.active ? 'active' : ''}`} onClick={() => fabricCanvas.current.setActiveObject(layer.object)}>
                <span className="layer-name">{layer.name}</span>
                <button className="layer-btn" onClick={(e) => {
                  e.stopPropagation();
                  layer.object.visible = !layer.object.visible;
                  fabricCanvas.current.renderAll();
                  setLayers([...layers]);
                }}>{layer.object.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="menu-item" onClick={() => fabricCanvas.current.remove(contextMenu.target)}>Delete</div>
        </div>
      )}

      <footer className="status-bar">
        <div>900 x 650 PX</div>
        <div>LOVART v0.1</div>
      </footer>
    </div>
  );
};

export default App;
