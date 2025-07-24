import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { SpeedInsights } from "@vercel/speed-insights/react";
import { removeBackground } from '@imgly/background-removal';

// Utility functions
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001'
  : '/api';

const API_KEY_STORAGE = 'pyckit_api_key';

// Components
const Sidebar = ({ onNewChat }) => (
  <div className="sidebar">
    <div className="sidebar-header">
      <div className="logo">
        <img src="/pyckit-logo.png" alt="Pyckit" style={{ height: 32, width: 'auto' }} />
      </div>
      <button className="new-chat-btn" onClick={onNewChat}>
        <span>+</span> New Analysis
      </button>
    </div>
    <div className="chat-history">
      <div className="chat-history-item active">Current Analysis</div>
    </div>
  </div>
);

const WelcomeScreen = ({ onFileSelect }) => {
  const fileInputRef = useRef(null);
  
  return (
    <div className="welcome-message">
      <h1 className="welcome-title">
        <img src="/pyckit-logo.png" alt="Pyckit" style={{ height: 60, width: 'auto' }} />
      </h1>
      <p className="welcome-subtitle">Discover hidden value in your Calgary home</p>
      
      <div className="upload-section" onClick={() => fileInputRef.current?.click()}>
        <div className="upload-icon">📸</div>
        <h2 className="upload-title">Upload Room Photo</h2>
        <p className="upload-subtitle">Take a clear photo of any room to discover sellable items</p>
      </div>

      <div style={{ marginTop: 40, padding: 20, backgroundColor: '#FEF3C7', borderRadius: 12, textAlign: 'left' }}>
        <h3 style={{ color: '#92400E', marginBottom: 8 }}>💡 How it works:</h3>
        <ol style={{ color: '#92400E', marginLeft: 20, lineHeight: 1.8 }}>
          <li>Take a clear photo of any room in your house</li>
          <li>Our AI identifies all sellable items automatically</li>
          <li>Background removal happens instantly in your browser (FREE!)</li>
          <li>Get Calgary market prices and descriptions</li>
          <li>Download professional product photos ready for listing</li>
        </ol>
      </div>
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onFileSelect}
        style={{ display: 'none' }}
      />
    </div>
  );
};

const ApiKeyPrompt = ({ onSave }) => {
  const [apiKey, setApiKey] = useState('');
  
  const handleSave = () => {
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      alert('Please enter a valid Claude API key (should start with sk-ant-)');
      return;
    }
    localStorage.setItem(API_KEY_STORAGE, apiKey);
    onSave();
  };
  
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <h2 style={{ color: 'var(--primary-color)', marginBottom: 20 }}>🔑 API Key Required</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
        To use Pyckit, you'll need a Claude API key from Anthropic.
      </p>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, fontStyle: 'italic' }}>
        ✨ Good news: Background removal is now FREE and runs in your browser!
      </p>
      <input
        type="password"
        placeholder="sk-ant-api03-..."
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        style={{
          width: '100%',
          maxWidth: 400,
          padding: 12,
          border: '2px solid var(--border-color)',
          borderRadius: 8,
          fontSize: 16,
          marginBottom: 20
        }}
      />
      <br />
      <button onClick={handleSave} className="send-btn" style={{ position: 'static', margin: '10px auto' }}>
        Save API Key
      </button>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 20 }}>
        Get your API key from{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" 
           style={{ color: 'var(--primary-color)' }}>
          console.anthropic.com
        </a>
      </p>
    </div>
  );
};

const ProcessingStatus = ({ current, total, currentItem }) => (
  <div style={{
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'white',
    padding: 40,
    borderRadius: 12,
    boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
    zIndex: 1000,
    textAlign: 'center',
    minWidth: 400
  }}>
    <h3 style={{ marginBottom: 20 }}>Processing Items...</h3>
    <div style={{
      width: '100%',
      height: 20,
      backgroundColor: '#f0f0f0',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 20
    }}>
      <div style={{
        width: `${(current / total) * 100}%`,
        height: '100%',
        backgroundColor: 'var(--primary-color)',
        transition: 'width 0.3s ease'
      }} />
    </div>
    <p style={{ color: 'var(--text-secondary)' }}>
      Processing item {current} of {total}
    </p>
    {currentItem && (
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 10 }}>
        {currentItem}
      </p>
    )}
  </div>
);

const ItemCard = ({ item, index }) => (
  <div className="item-card">
    <img 
      className="item-thumbnail-large" 
      src={item.processedImage || item.stagedImage || '#'}
      alt={item.name}
      style={{ backgroundColor: item.processedImage ? 'white' : '#f0f0f0' }}
    />
    <div className="item-name">{item.name}</div>
    <div className="item-value">${item.value}</div>
    <div className="item-details">
      <p><strong>Condition:</strong> {item.condition}</p>
      <p><strong>Description:</strong> {item.description || `${item.condition || 'Good'} condition ${item.name.toLowerCase()}. Well-maintained and ready for immediate use.`}</p>
    </div>
    <span className="confidence-badge">{item.confidence}% match</span>
    
    {item.processed && (
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.download = `${item.name.replace(/\s+/g, '_')}_listing.jpg`;
            link.href = item.processedImage;
            link.click();
          }}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: 'var(--primary-color)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          💾 Download
        </button>
      </div>
    )}
  </div>
);

const ImageAnalysis = ({ analysisData, imageFile }) => {
  const [items] = useState(analysisData.items || []);
  const [totalValue] = useState(analysisData.totalValue || 0);
  
  return (
    <div className="inventory-results">
      <div className="total-value">
        <h3>Total Estimated Value</h3>
        <div className="amount">
          ${totalValue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      </div>
      
      <h3 style={{ marginBottom: 16, textAlign: 'center' }}>🏠 Your Sellable Items</h3>
      
      <div className="items-grid">
        {items.map((item, index) => (
          <ItemCard key={index} item={item} index={index} />
        ))}
      </div>
      
      {analysisData.insights?.quickWins && (
        <div style={{ marginTop: 24, padding: 16, backgroundColor: '#E8F5E9', borderRadius: 8, maxWidth: 800, margin: '24px auto' }}>
          <h4 style={{ color: '#2E7D32', marginBottom: 8 }}>💡 Results:</h4>
          <ul style={{ color: '#2E7D32', marginLeft: 20, lineHeight: 1.6 }}>
            {analysisData.insights.quickWins.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// New function to process items locally with background removal
async function processItemsLocally(items, imageFile, onProgress) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  return new Promise((resolve) => {
    img.onload = async () => {
      const processedItems = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress(i + 1, items.length, item.name);
        
        try {
          // Calculate crop dimensions with padding
          const padding = 0.4;
          let x = (item.boundingBox.x / 100) * img.width;
          let y = (item.boundingBox.y / 100) * img.height;
          let width = (item.boundingBox.width / 100) * img.width;
          let height = (item.boundingBox.height / 100) * img.height;
          
          // Add padding
          const padX = width * padding;
          const padY = height * padding;
          x = Math.max(0, x - padX);
          y = Math.max(0, y - padY);
          width = Math.min(width + (padX * 2), img.width - x);
          height = Math.min(height + (padY * 2), img.height - y);
          
          // Crop the image
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
          
          const croppedBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          
          // Remove background using client-side library
          let removedBgBlob;
          try {
            removedBgBlob = await removeBackground(croppedBlob);
          } catch (bgError) {
            console.error('Background removal failed, using original:', bgError);
            removedBgBlob = croppedBlob;
          }
          
          // Create final image with white background
          const finalCanvas = document.createElement('canvas');
          const finalCtx = finalCanvas.getContext('2d');
          finalCanvas.width = width;
          finalCanvas.height = height;
          
          // White background
          finalCtx.fillStyle = 'white';
          finalCtx.fillRect(0, 0, width, height);
          
          // Draw transparent image on white background
          const transparentImg = new Image();
          await new Promise((imgResolve) => {
            transparentImg.onload = () => {
              finalCtx.drawImage(transparentImg, 0, 0);
              imgResolve();
            };
            transparentImg.src = URL.createObjectURL(removedBgBlob);
          });
          
          const finalImage = finalCanvas.toDataURL('image/jpeg', 0.9);
          
          processedItems.push({
            ...item,
            processedImage: finalImage,
            processed: true
          });
          
        } catch (error) {
          console.error(`Failed to process ${item.name}:`, error);
          processedItems.push({
            ...item,
            processed: false,
            error: error.message
          });
        }
      }
      
      resolve(processedItems);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
}

// Main App Component
export default function App() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [, setSelectedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState(null);
  const fileInputRef = useRef(null);
  
  useEffect(() => {
    const storedKey = localStorage.getItem(API_KEY_STORAGE);
    setHasApiKey(!!storedKey);
  }, []);
  
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedImage(file);
      sendMessage('Analyze this room for sellable items', file);
    }
  };
  
  const sendMessage = async (text, imageFile) => {
    const apiKey = localStorage.getItem(API_KEY_STORAGE);
    if (!apiKey) {
      setHasApiKey(false);
      return;
    }
    
    setMessages([...messages, { role: 'user', text, image: imageFile }]);
    setIsLoading(true);
    
    if (imageFile) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1];
        
        try {
          // Step 1: Get AI detection
          const endpoint = API_URL + (API_URL.endsWith('/api') ? '/analyze-simple' : '/api/analyze-simple');
          console.log('Sending request to:', endpoint);
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64,
              apiKey: apiKey,
              roomType: 'unknown'
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
          }
          
          const data = await response.json();
          
          if (data.success) {
            // Step 2: Process backgrounds locally
            console.log('Processing backgrounds locally...');
            setProcessingStatus({ current: 0, total: data.items.length });
            
            const processedItems = await processItemsLocally(
              data.items, 
              imageFile,
              (current, total, itemName) => {
                setProcessingStatus({ current, total, currentItem: itemName });
              }
            );
            
            setProcessingStatus(null);
            
            const analysisData = {
              ...data,
              items: processedItems,
              imageFile
            };
            
            setMessages(prev => [...prev, { 
              role: 'assistant', 
              component: <ImageAnalysis analysisData={analysisData} imageFile={imageFile} />
            }]);
          } else {
            throw new Error(data.error || 'Analysis failed');
          }
        } catch (error) {
          console.error('Full error details:', error);
          setProcessingStatus(null);
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            text: `Error: ${error.message}. Please check the console for more details.` 
          }]);
        }
        
        setIsLoading(false);
      };
      reader.readAsDataURL(imageFile);
    }
    
    setInputText('');
    setSelectedImage(null);
  };
  
  if (!hasApiKey) {
    return (
      <div className="app-container">
        <Sidebar onNewChat={() => window.location.reload()} />
        <div className="main-content">
          <div className="chat-header">
            <div className="model-selector">
              <span className="model-name">Pyckit Vision AI ▼</span>
            </div>
          </div>
          <div className="chat-messages">
            <div className="message-container">
              <ApiKeyPrompt onSave={() => setHasApiKey(true)} />
            </div>
          </div>
        </div>
        <SpeedInsights />
      </div>
    );
  }
  
  return (
    <div className="app-container">
      <Sidebar onNewChat={() => window.location.reload()} />
      
      <div className="main-content">
        <div className="chat-header">
          <div className="model-selector">
            <span className="model-name">Pyckit Vision AI ▼</span>
          </div>
        </div>
        
        <div className="chat-messages">
          <div className="message-container">
            {messages.length === 0 && (
              <WelcomeScreen onFileSelect={handleFileSelect} />
            )}
            
            {messages.map((msg, index) => (
              <div key={index} className="message">
                <div className={`message-avatar ${msg.role === 'user' ? 'user-avatar' : 'assistant-avatar'}`}>
                  {msg.role === 'user' ? 'U' : 'P'}
                </div>
                <div className="message-content">
                  {msg.component || <div className="message-text">{msg.text}</div>}
                  {msg.image && (
                    <div className="image-preview" style={{ marginTop: 12 }}>
                      <img src={URL.createObjectURL(msg.image)} alt="Uploaded" />
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {isLoading && !processingStatus && (
              <div className="message">
                <div className="message-avatar assistant-avatar">P</div>
                <div className="message-content">
                  <div className="loading-dots">
                    <div className="loading-dot"></div>
                    <div className="loading-dot"></div>
                    <div className="loading-dot"></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="input-container">
          <div className="input-wrapper">
            <button className="attach-btn" onClick={() => fileInputRef.current?.click()}>
              📎
            </button>
            <textarea
              className="input-box"
              placeholder="Upload a room photo to discover sellable items..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(inputText);
                }
              }}
              rows={1}
            />
            <button className="send-btn" onClick={() => sendMessage(inputText)}>
              Send
            </button>
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>
      </div>
      
      {processingStatus && (
        <ProcessingStatus {...processingStatus} />
      )}
      
      <SpeedInsights />
    </div>
  );
}