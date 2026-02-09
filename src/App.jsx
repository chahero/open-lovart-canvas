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

// Custom control styling for Fabric.js
const initFabricStyling = () => {
  fabric.Object.prototype.transparentCorners = false;
  fabric.Object.prototype.cornerColor = '#3b82f6';
  fabric.Object.prototype.cornerStyle = 'circle';
  fabric.Object.prototype.cornerSize = 10;
  fabric.Object.prototype.borderColor = '#3b82f6';
  fabric.Object.prototype.borderScaleFactor = 2;
  fabric.Object.prototype.padding = 4;
};

const App = () => {
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);

  useEffect(() => {
    initFabricStyling();

    const canvas = new fabric.Canvas(canvasRef.current, {
      backgroundColor: '#ffffff',
      width: 900,
      height: 650,
      preserveObjectStacking: true,
    });

    fabricCanvas.current = canvas;

    const updateUIState = () => {
      // Update Layers
      const currentObjects = canvas.getObjects().map((obj, index) => ({
        id: obj.id || (obj.id = Math.random().toString(36).substr(2, 9)),
        name: obj.name || `${obj.type} ${index + 1}`,
        visible: obj.visible,
        active: obj === canvas.getActiveObject(),
        object: obj,
        type: obj.type
      })).reverse();
      setLayers(currentObjects);

      // Update Selected Object
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

    // Keyboard Shortcuts
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const active = canvas.getActiveObject();
      if (!active) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        canvas.remove(active);
        canvas.discardActiveObject().renderAll();
      }
      if (e.ctrlKey && e.key === 'c') {
        active.clone((cloned) => {
          canvas._clipboard = cloned;
        });
      }
      if (e.ctrlKey && e.key === 'v') {
        if (canvas._clipboard) {
          canvas._clipboard.clone((clonedObj) => {
            canvas.discardActiveObject();
            clonedObj.set({
              left: clonedObj.left + 10,
              top: clonedObj.top + 10,
              evented: true,
            });
            if (clonedObj.type === 'activeSelection') {
              clonedObj.canvas = canvas;
              clonedObj.forEachObject((obj) => {
                canvas.add(obj);
              });
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

    // Right Click
    canvas.on('mouse:down', (opt) => {
      if (opt.button === 3) {
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
  }, []);

  // Tool Actions
  const addRect = () => {
    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      fill: 'rgba(59, 130, 246, 0.5)',
      width: 150,
      height: 150,
      rx: 12, ry: 12,
      stroke: '#3b82f6',
      strokeWidth: 2
    });
    fabricCanvas.current.add(rect);
    fabricCanvas.current.setActiveObject(rect);
  };

  const addText = () => {
    const text = new fabric.IText('Double Click to Edit', {
      left: 150,
      top: 150,
      fontFamily: 'Inter',
      fontSize: 24,
      fill: '#18181b'
    });
    fabricCanvas.current.add(text);
    fabricCanvas.current.setActiveObject(text);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (f) => {
      fabric.Image.fromURL(f.target.result, (img) => {
        img.scaleToWidth(400);
        img.name = file.name;
        fabricCanvas.current.add(img);
        fabricCanvas.current.centerObject(img);
        fabricCanvas.current.setActiveObject(img);
      });
    };
    reader.readAsDataURL(file);
  };

  // Property Handlers
  const setProperty = (prop, value) => {
    const active = fabricCanvas.current.getActiveObject();
    if (!active) return;
    active.set(prop, value);
    fabricCanvas.current.renderAll();
    setSelectedObject({ ...selectedObject, [prop]: value });
  };

  // Stack/Order Handlers
  const moveUp = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (active) fabricCanvas.current.bringForward(active);
  };
  const moveDown = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (active) fabricCanvas.current.sendBackwards(active);
  };

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
        <button className="tool-btn" onClick={addRect}>
          <Square size={22} />
        </button>
        <button className="tool-btn" onClick={addText}>
          <Type size={22} />
        </button>
        <button className="tool-btn">
          <Edit3 size={22} />
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
          <button className="action-btn" onClick={() => alert('Feature coming soon...')}>
            <Maximize size={15} /> Upscale
          </button>
          <button className="action-btn" onClick={() => alert('Feature coming soon...')}>
            <Scissors size={15} /> Remove bg
          </button>
          <button className="action-btn" onClick={() => alert('Feature coming soon...')}>
            <Target size={15} /> Edit Elements
          </button>
          <button className="action-btn" onClick={() => alert('Feature coming soon...')}>
            <Type size={15} /> Edit Text
          </button>
          <button className="action-btn">
            <MoreHorizontal size={15} />
          </button>
        </div>

        <div className="topbar-right">
          <button className="action-btn" style={{ background: 'var(--accent)', color: 'white' }}>
            <Download size={15} /> Export
          </button>
        </div>
      </header>

      {/* Main Canvas */}
      <main className="canvas-container">
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} />
        </div>
      </main>

      {/* Properties & Layers */}
      <aside className="properties-panel">
        <div className="property-group">
          <h3 className="panel-title">Selection</h3>
          {selectedObject ? (
            <>
              <div className="property-row">
                <span className="property-label">Fill</span>
                <input
                  type="color"
                  className="color-input"
                  value={typeof selectedObject.fill === 'string' ? selectedObject.fill : '#000000'}
                  onChange={(e) => setProperty('fill', e.target.value)}
                />
              </div>
              <div className="property-row">
                <span className="property-label">Opacity</span>
                <input
                  type="range"
                  className="property-slider"
                  min="0" max="1" step="0.01"
                  value={selectedObject.opacity || 1}
                  onChange={(e) => setProperty('opacity', parseFloat(e.target.value))}
                />
                <span style={{ fontSize: '11px', width: '30px' }}>{Math.round((selectedObject.opacity || 1) * 100)}%</span>
              </div>
              <div className="property-row" style={{ marginTop: '12px' }}>
                <span className="property-label">Rotation</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="layer-btn" onClick={() => setProperty('angle', (fabricCanvas.current.getActiveObject().angle - 90) % 360)}>
                    <RotateCcw size={16} />
                  </button>
                  <button className="layer-btn" onClick={() => setProperty('angle', (fabricCanvas.current.getActiveObject().angle + 90) % 360)}>
                    <RotateCw size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nothing selected</p>
          )}
        </div>

        <div className="property-group" style={{ flexGrow: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="panel-title" style={{ marginBottom: 0 }}>Layers</h3>
            <LayersIcon size={14} color="var(--text-muted)" />
          </div>
          <div className="layers-list">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className={`layer-item ${layer.active ? 'active' : ''}`}
                onClick={() => {
                  fabricCanvas.current.setActiveObject(layer.object);
                  fabricCanvas.current.renderAll();
                }}
              >
                <div className="layer-preview">
                  {layer.type === 'text' || layer.type === 'i-text' ? <Type size={14} /> :
                    layer.type === 'image' ? <ImageIcon size={14} /> : <Square size={14} />}
                </div>
                <span className="layer-name">{layer.name}</span>
                <div className="layer-actions">
                  <button className="layer-btn" onClick={(e) => {
                    e.stopPropagation();
                    layer.object.visible = !layer.object.visible;
                    fabricCanvas.current.renderAll();
                    setLayers([...layers]);
                  }}>
                    {layer.object.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button className="layer-btn" onClick={(e) => {
                    e.stopPropagation();
                    fabricCanvas.current.remove(layer.object);
                  }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="menu-item" onClick={() => {
            contextMenu.target.clone(c => fabricCanvas.current._clipboard = c);
            setContextMenu(null);
          }}>
            <span>Copy</span>
            <span className="menu-shortcut">Ctrl+C</span>
          </div>
          <div className="menu-divider"></div>
          <div className="menu-item" onClick={moveUp}>
            <span>Bring Forward</span>
            <span className="menu-shortcut">Ctrl+Up</span>
          </div>
          <div className="menu-item" onClick={moveDown}>
            <span>Send Backward</span>
            <span className="menu-shortcut">Ctrl+Down</span>
          </div>
          <div className="menu-divider"></div>
          <div className="menu-item" style={{ color: '#ef4444' }} onClick={() => {
            fabricCanvas.current.remove(contextMenu.target);
            setContextMenu(null);
          }}>
            <span>Delete</span>
            <span className="menu-shortcut">Del</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="status-bar">
        <div style={{ display: 'flex', gap: '16px' }}>
          <span>900 x 650 PX</span>
          <span>CUR: {selectedObject ? `${selectedObject.left}, ${selectedObject.top}` : '0, 0'}</span>
        </div>
        <div>
          <span>LOVART Alpha v0.1</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
