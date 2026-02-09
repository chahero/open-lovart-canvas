import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  MousePointer2,
  Square,
  Type,
  Eraser,
  Image as ImageIcon,
  Scissors,
  Maximize,
  Minus,
  Layers as LayersIcon,
  Settings,
  Download,
  Trash2,
  Eye,
  EyeOff,
  MoreHorizontal,
  CloudUpload,
  Sparkles,
  Zap,
  Target,
  Edit3,
  Copy,
  Clipboard,
  ChevronUp,
  ChevronDown,
  Layout,
  Lock,
  Unlock,
  Move
} from 'lucide-react';
import { fabric } from 'fabric';
import './App.css';

const App = () => {
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const canvasRef = useRef(null);
  const fabricCanvas = useRef(null);

  useEffect(() => {
    // Initialize Fabric Canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      backgroundColor: '#ffffff',
      width: 900,
      height: 650,
      preserveObjectStacking: true,
    });

    fabricCanvas.current = canvas;

    // Handle object additions/updates
    const updateLayers = () => {
      const currentObjects = canvas.getObjects().map((obj, index) => ({
        id: obj.id || (obj.id = Math.random().toString(36).substr(2, 9)),
        name: obj.name || obj.type,
        visible: obj.visible,
        active: obj === canvas.getActiveObject(),
        object: obj,
        type: obj.type
      })).reverse();
      setLayers(currentObjects);
    };

    canvas.on('object:added', updateLayers);
    canvas.on('object:removed', updateLayers);
    canvas.on('selection:created', (e) => {
      updateLayers();
      setSelectedObjectId(e.target.id);
    });
    canvas.on('selection:updated', (e) => {
      updateLayers();
      setSelectedObjectId(e.target.id);
    });
    canvas.on('selection:cleared', () => {
      updateLayers();
      setSelectedObjectId(null);
      setContextMenu(null);
    });

    // Custom Context Menu
    canvas.on('mouse:down', (options) => {
      if (options.button === 3) { // Right click
        if (options.target) {
          canvas.setActiveObject(options.target);
          setContextMenu({
            x: options.e.clientX,
            y: options.e.clientY,
            target: options.target
          });
        } else {
          setContextMenu(null);
        }
      } else {
        setContextMenu(null);
      }
    });

    // Window resize handle
    const handleResize = () => {
      // Implement if needed
    };
    window.addEventListener('resize', handleResize);

    return () => {
      canvas.dispose();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Utility Actions
  const addRect = () => {
    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      fill: 'rgba(59, 130, 246, 0.5)',
      width: 150,
      height: 150,
      rx: 12,
      ry: 12,
      stroke: '#3b82f6',
      strokeWidth: 2,
    });
    fabricCanvas.current.add(rect);
    fabricCanvas.current.setActiveObject(rect);
  };

  const addText = () => {
    const text = new fabric.IText('Creative Design', {
      left: 200,
      top: 200,
      fontFamily: 'Outfit, sans-serif',
      fontSize: 42,
      fontWeight: 'bold',
      fill: '#000000'
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
        img.scaleToWidth(500);
        img.name = file.name;
        fabricCanvas.current.add(img);
        fabricCanvas.current.centerObject(img);
        fabricCanvas.current.setActiveObject(img);
      });
    };
    reader.readAsDataURL(file);
  };

  // Stack Actions
  const moveUp = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (active) {
      fabricCanvas.current.bringForward(active);
      fabricCanvas.current.fire('object:added'); // trigger layer update
    }
  };

  const moveDown = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (active) {
      fabricCanvas.current.sendBackwards(active);
      fabricCanvas.current.fire('object:removed'); // trigger layer update (re-use event)
    }
  };

  // AI Feature Mockups
  const runAISegment = () => {
    const active = fabricCanvas.current.getActiveObject();
    if (!active || active.type !== 'image') {
      alert('Please select an image to segment elements.');
      return;
    }
    // Conceptual magic: In a real app, we'd call SAM API here.
    alert('AI is analyzing image elements... (SAM Integration)');
  };

  return (
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      {/* Left Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Sparkles size={28} />
        </div>
        <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')}>
          <MousePointer2 size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'rect' ? 'active' : ''}`} onClick={() => setActiveTool('rect')}>
          <Plus size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'shape' ? 'active' : ''}`} onClick={addRect}>
          <Square size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'text' ? 'active' : ''}`} onClick={addText}>
          <Type size={22} />
        </button>
        <button className={`tool-btn ${activeTool === 'draw' ? 'active' : ''}`} onClick={() => setActiveTool('draw')}>
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
          <h2 style={{ fontSize: '16px', fontWeight: '700', letterSpacing: '-0.2px', opacity: 0.9 }}>
            LOVART <span style={{ color: 'var(--text-muted)', fontWeight: '400', marginLeft: '8px' }}>Project Alpha</span>
          </h2>
        </div>

        <div className="topbar-actions">
          <button className="action-btn" onClick={() => alert('Upscaling...')}>
            <Maximize size={15} /> Upscale
          </button>
          <button className="action-btn" onClick={() => alert('Removing BG...')}>
            <Scissors size={15} /> Remove bg
          </button>
          <button className="action-btn" onClick={runAISegment}>
            <Target size={15} /> Edit Elements
          </button>
          <button className="action-btn new-badge" onClick={() => alert('OCR Editing...')}>
            <Type size={15} /> Edit Text
          </button>
          <button className="action-btn">
            <MoreHorizontal size={15} />
          </button>
        </div>

        <div className="topbar-right">
          <button className="action-btn primary">
            <Download size={15} /> Export
          </button>
        </div>
      </header>

      {/* Canvas */}
      <main className="canvas-container">
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} />
        </div>

        {/* Floating Quick Edit (Mock) */}
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '30px',
          padding: '6px 20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          zIndex: 30,
        }}>
          <span style={{ fontSize: '13px', fontWeight: '500' }}>Quick Edit</span>
          <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border)' }}></div>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <Sparkles size={16} />
          </button>
        </div>
      </main>

      {/* Properties & Layers */}
      <aside className="properties-panel">
        <div className="panel-header">
          <h3 className="panel-title">Layers</h3>
          <LayersIcon size={16} color="var(--text-muted)" />
        </div>

        <div className="layers-list" style={{ flexGrow: 1, overflowY: 'auto' }}>
          {layers.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: '40px', color: 'var(--text-muted)' }}>
              <CloudUpload size={32} strokeWidth={1} style={{ marginBottom: '12px' }} />
              <p style={{ fontSize: '12px' }}>Drop an image to start</p>
            </div>
          )}
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

        <div className="panel-section" style={{ borderTop: '1px solid var(--border)', paddingTop: '20px', marginTop: '20px' }}>
          <h3 className="panel-title" style={{ marginBottom: '16px' }}>Properties</h3>
          {selectedObjectId ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="panel-item">
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Position X</span>
                <div style={{ background: 'var(--bg-tertiary)', padding: '6px', borderRadius: '6px', fontSize: '12px', marginTop: '4px' }}>
                  {Math.round(fabricCanvas.current?.getActiveObject()?.left || 0)}
                </div>
              </div>
              <div className="panel-item">
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Position Y</span>
                <div style={{ background: 'var(--bg-tertiary)', padding: '6px', borderRadius: '6px', fontSize: '12px', marginTop: '4px' }}>
                  {Math.round(fabricCanvas.current?.getActiveObject()?.top || 0)}
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Select an object to edit properties</p>
          )}
        </div>
      </aside>

      {/* Context Menu Rendering */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={() => setContextMenu(null)}
        >
          <div className="menu-item" onClick={Copy}>
            <span>Copy</span>
            <span className="shortcut">⌘ C</span>
          </div>
          <div className="menu-item">
            <span>Paste</span>
            <span className="shortcut">⌘ V</span>
          </div>
          <div className="menu-divider"></div>
          <div className="menu-item" onClick={moveUp}>
            <span>Move up</span>
            <span className="shortcut">⌘ ]</span>
          </div>
          <div className="menu-item" onClick={moveDown}>
            <span>Move down</span>
            <span className="shortcut">⌘ [</span>
          </div>
          <div className="menu-item" onClick={() => fabricCanvas.current.bringToFront(contextMenu.target)}>
            <span>Bring to front</span>
            <span className="shortcut">]</span>
          </div>
          <div className="menu-item" onClick={() => fabricCanvas.current.sendToBack(contextMenu.target)}>
            <span>Send to back</span>
            <span className="shortcut">[</span>
          </div>
          <div className="menu-divider"></div>
          <div className="menu-item" style={{ color: '#ef4444' }} onClick={() => fabricCanvas.current.remove(contextMenu.target)}>
            <span>Delete</span>
            <span className="shortcut">Del</span>
          </div>
        </div>
      )}

      {/* Fixed Footer */}
      <footer className="status-bar">
        <div style={{ display: 'flex', gap: '16px' }}>
          <span>900 x 650 PX</span>
          <span>CUR: {Math.round(fabricCanvas.current?.getPointer()?.x || 0)}, {Math.round(fabricCanvas.current?.getPointer()?.y || 0)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></div>
          <span style={{ fontWeight: '600', color: '#22c55e' }}>ONLINE</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
