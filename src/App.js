// Rewritten App.js to preserve layout/styling while upgrading cropping and output consistency

import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '/api';

export default function App() {
  const [hasKey, setHasKey] = useState(false);
  const [items, setItems] = useState([]);
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const key = localStorage.getItem('pyckit_api_key');
    setHasKey(!!key);
  }, []);

  const handleFileChange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];

      const res = await fetch(`${API_URL}/analyze-simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });

      const json = await res.json();
      if (json.success) {
        const processed = await processImages(json.items, f);
        setItems(processed);
      } else {
        alert('Error analyzing image.');
      }
    };
    reader.readAsDataURL(f);
  };

  const processImages = async (items, imgFile) => {
    const image = new Image();
    const url = URL.createObjectURL(imgFile);
    image.src = url;

    await new Promise(res => (image.onload = res));

    return items.map((item, index) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const { width, height } = image;
      const box = item.boundingBox;

      const cx = (box.x / 100) * width;
      const cy = (box.y / 100) * height;
      const bw = (box.width / 100) * width;
      const bh = (box.height / 100) * height;

      const padX = bw * 0.15;
      const padY = bh * 0.15;

      const sx = Math.max(0, cx - bw / 2 - padX);
      const sy = Math.max(0, cy - bh / 2 - padY);
      const sw = Math.min(width - sx, bw + 2 * padX);
      const sh = Math.min(height - sy, bh + 2 * padY);

      canvas.width = sw;
      canvas.height = sh;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

      return {
        ...item,
        name: item.name || `Item ${index + 1}`,
        description: item.description || `Good condition ${item.name?.toLowerCase() || 'item'}. Ready to use.`,
        processedImage: canvas.toDataURL('image/jpeg', 0.9),
        processed: true
      };
    });
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <img src="/pyckit-logo.png" alt="Pyckit" style={{ height: 32 }} />
          </div>
          <button className="new-chat-btn" onClick={() => window.location.reload()}>
            <span>+</span> New Analysis
          </button>
        </div>
        <div className="chat-history">
          <div className="chat-history-item active">Current Analysis</div>
        </div>
      </div>

      <div className="main-content">
        <div className="chat-header">
          <div className="model-selector">
            <span className="model-name">Pyckit Vision AI ▼</span>
          </div>
        </div>

        <div className="chat-messages">
          <div className="message-container">
            {!file && (
              <div className="welcome-message">
                <h1 className="welcome-title">
                  <img src="/pyckit-logo.png" alt="Pyckit" style={{ height: 60 }} />
                </h1>
                <p className="welcome-subtitle">Discover hidden value in your Calgary home</p>
                <div className="upload-section" onClick={() => fileInputRef.current.click()}>
                  <div className="upload-icon">📸</div>
                  <h2 className="upload-title">Upload Room Photo</h2>
                  <p className="upload-subtitle">Take a clear photo of any room to discover sellable items</p>
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="inventory-results">
                <div className="total-value">
                  <h3>Total Estimated Value</h3>
                  <div className="amount">
                    ${items.reduce((sum, i) => sum + parseFloat(i.value || 0), 0).toLocaleString('en-CA')}
                  </div>
                </div>
                <div className="items-grid">
                  {items.map((item, i) => (
                    <div key={i} className="item-card">
                      <img className="item-thumbnail-large" src={item.processedImage} alt={item.name} />
                      <div className="item-name">{item.name}</div>
                      <div className="item-value">${item.value}</div>
                      <div className="item-details">
                        <p><strong>Condition:</strong> {item.condition}</p>
                        <p><strong>Description:</strong> {item.description}</p>
                      </div>
                      <span className="confidence-badge">{item.confidence}% match</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
