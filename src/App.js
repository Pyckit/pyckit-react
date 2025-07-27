import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { SpeedInsights } from "@vercel/speed-insights/react";

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

const ItemCard = ({ item, index, onEdit, onRemove }) => (
  <div 
    className="item-card" 
    onClick={() => {
      console.log('Card clicked - opening edit modal for index:', index);
      onEdit(index);
    }}
    style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      cursor: 'pointer',
      position: 'relative',
      minHeight: '520px'
    }}
  >
    <button 
      className="remove-btn"
      onClick={(e) => {
        e.stopPropagation();
        onRemove(index);
      }}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: '#ff4444',
        color: 'white',
        border: 'none',
        borderRadius: '50%',
        width: 30,
        height: 30,
        cursor: 'pointer',
        fontSize: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1
      }}
    >
      ×
    </button>
    
    <img 
      className="item-thumbnail-large" 
      src={item.processedImage || item.stagedImage || '#'}
      alt={item.name}
      style={{ backgroundColor: item.processedImage ? 'white' : '#f0f0f0' }}
    />
    <div className="item-name">{item.name}</div>
    <div className="item-value">${item.value}</div>
    <div className="item-details" style={{ flexGrow: 1 }}>
      <p><strong>Condition:</strong> {item.condition}</p>
      <p><strong>Description:</strong> {item.description || `${item.condition || 'Good'} condition ${item.name.toLowerCase()}. Well-maintained and ready for immediate use.`}</p>
      <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}><strong>Best time:</strong> Year-round</p>
    </div>
    <span className="confidence-badge">{item.confidence}% match</span>
    
    <div 
      style={{ 
        display: 'flex', 
        gap: 8, 
        marginTop: 'auto',
        paddingTop: 12
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onEdit(index)}
        style={{
          flex: 1,
          padding: '8px 16px',
          background: 'transparent',
          color: '#666',
          border: '1px solid #ddd',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: '500',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
        onMouseEnter={(e) => {
          e.target.style.borderColor = '#999';
          e.target.style.color = '#333';
          e.target.style.background = '#f8f8f8';
        }}
        onMouseLeave={(e) => {
          e.target.style.borderColor = '#ddd';
          e.target.style.color = '#666';
          e.target.style.background = 'transparent';
        }}
      >
        Edit
      </button>
      <button
        onClick={() => alert(`Listed: ${item.name} for $${item.value}`)}
        style={{
          flex: 1,
          padding: '8px 16px',
          background: '#000',
          color: 'white',
          border: '1px solid #000',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: '500',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
        onMouseEnter={(e) => {
          e.target.style.background = '#333';
          e.target.style.borderColor = '#333';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = '#000';
          e.target.style.borderColor = '#000';
        }}
      >
        List Item
      </button>
    </div>
  </div>
);

const EditModal = ({ item, onSave, onClose, onList }) => {
  const [title, setTitle] = useState(item.name);
  const [price, setPrice] = useState(item.value);
  const [condition, setCondition] = useState(item.condition);
  const [description, setDescription] = useState(item.description || '');
  
  const handleSave = () => {
    onSave({ ...item, name: title, value: price, condition, description });
  };
  
  const handleList = () => {
    const updatedItem = { ...item, name: title, value: price, condition, description };
    onSave(updatedItem, false); // false = don't show save notification
    onList(updatedItem);
  };
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'white',
        borderRadius: 12,
        padding: 32,
        maxWidth: 600,
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>Edit Listing #{item.index + 1}</h2>
          <button
            onClick={onClose}
            style={{
              background: '#ff4444',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              cursor: 'pointer',
              fontSize: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: '#666' }}>
            TITLE
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%',
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              fontSize: 16
            }}
          />
        </div>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: '#666' }}>
            PRICE
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{
              width: '100%',
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              fontSize: 16
            }}
          />
        </div>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: '#666' }}>
            CONDITION
          </label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            style={{
              width: '100%',
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              fontSize: 16
            }}
          >
            <option value="Excellent">Excellent</option>
            <option value="Very Good">Very Good</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
          </select>
        </div>
        
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: '#666' }}>
            DESCRIPTION
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              fontSize: 16,
              resize: 'vertical'
            }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={handleSave}
            style={{
              flex: 1,
              padding: '10px 20px',
              background: 'transparent',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: 6,
              fontSize: 15,
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = '#999';
              e.target.style.color = '#333';
              e.target.style.background = '#f8f8f8';
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = '#ddd';
              e.target.style.color = '#666';
              e.target.style.background = 'transparent';
            }}
          >
            Save
          </button>
          <button
            onClick={handleList}
            style={{
              flex: 1,
              padding: '10px 20px',
              background: '#000',
              color: 'white',
              border: '1px solid #000',
              borderRadius: 6,
              fontSize: 15,
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#333';
              e.target.style.borderColor = '#333';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = '#000';
              e.target.style.borderColor = '#000';
            }}
          >
            List Item
          </button>
        </div>
      </div>
    </div>
  );
};

const ImageAnalysis = ({ analysisData, imageFile }) => {
  const [items, setItems] = useState(analysisData.items || []);
  const [totalValue, setTotalValue] = useState(analysisData.totalValue || 0);
  const [editingItem, setEditingItem] = useState(null);
  
  const handleEdit = (index) => {
    setEditingItem({ ...items[index], index });
  };
  
  const handleSave = (updatedItem, showNotification = true) => {
    const newItems = [...items];
    newItems[updatedItem.index] = updatedItem;
    setItems(newItems);
    
    // Recalculate total
    const newTotal = newItems.reduce((sum, item) => sum + parseFloat(item.value || 0), 0);
    setTotalValue(newTotal);
    
    setEditingItem(null);
    if (showNotification) {
      alert('Changes saved! You can list this item later.');
    }
  };
  
  const handleListFromModal = (item) => {
    alert(`Listed: ${item.name} for $${item.value}`);
  };
  
  const handleRemove = (index) => {
    if (window.confirm('Remove this item from the list?')) {
      const newItems = items.filter((_, i) => i !== index);
      setItems(newItems);
      
      // Recalculate total
      const newTotal = newItems.reduce((sum, item) => sum + parseFloat(item.value || 0), 0);
      setTotalValue(newTotal);
    }
  };
  
  const handleListAll = () => {
    alert(`Ready to list all ${items.length} items! Total value: $${totalValue}`);
  };
  
  return (
    <div className="inventory-results">
      <div className="total-value">
        <h3>Total Estimated Value</h3>
        <div className="amount">
          ${totalValue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      </div>
      
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <button
          onClick={handleListAll}
          style={{
            padding: '16px 48px',
            background: 'var(--primary-color)',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 18,
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          List All Items ({items.length})
        </button>
      </div>
      
      <h3 style={{ marginBottom: 16, textAlign: 'center' }}>🏠 Your Sellable Items</h3>
      
      <div className="items-grid">
        {items.map((item, index) => (
          <ItemCard 
            key={index} 
            item={item} 
            index={index} 
            onEdit={handleEdit}
            onRemove={handleRemove}
          />
        ))}
      </div>
      
      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={handleSave}
          onList={handleListFromModal}
          onClose={() => setEditingItem(null)}
        />
      )}
      
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

// Helper function to get mask bounds
function getMaskBounds(mask, width, height) {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0.5) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

// Updated function to handle segmentation masks from backend
async function processItemsLocally(items, imageFile, onProgress) {
  const img = new Image();
  
  return new Promise((resolve) => {
    img.onload = async () => {
      const processedItems = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress(i + 1, items.length, item.name);
        
        try {
          // If we have a segmentation mask from the backend, use it
          if (item.hasSegmentation && item.segmentationMask) {
            // Apply the mask to isolate the object
            const isolatedImage = await applySegmentationMask(img, item.segmentationMask, item.boundingBox);
            processedItems.push({
              ...item,
              processedImage: isolatedImage,
              processed: true
            });
          } else {
            // Fallback to simple cropping with background removal
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Calculate crop with generous padding
            const padding = 1.0;
            const centerX = (item.boundingBox.x / 100) * img.width;
            const centerY = (item.boundingBox.y / 100) * img.height;
            const cropWidth = (item.boundingBox.width / 100) * img.width * (1 + padding);
            const cropHeight = (item.boundingBox.height / 100) * img.height * (1 + padding);
            
            const cropX = Math.max(0, centerX - cropWidth / 2);
            const cropY = Math.max(0, centerY - cropHeight / 2);
            
            canvas.width = Math.min(cropWidth, img.width - cropX);
            canvas.height = Math.min(cropHeight, img.height - cropY);
            
            // White background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw cropped area
            ctx.drawImage(
              img,
              cropX, cropY, canvas.width, canvas.height,
              0, 0, canvas.width, canvas.height
            );
            
            // Try background removal
            try {
              const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
              const removedBgBlob = await removeBackground(blob);
              
              const finalCanvas = document.createElement('canvas');
              const finalCtx = finalCanvas.getContext('2d');
              finalCanvas.width = canvas.width;
              finalCanvas.height = canvas.height;
              
              finalCtx.fillStyle = '#ffffff';
              finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
              
              const removedImg = new Image();
              await new Promise((imgResolve) => {
                removedImg.onload = () => {
                  finalCtx.drawImage(removedImg, 0, 0);
                  imgResolve();
                };
                removedImg.src = URL.createObjectURL(removedBgBlob);
              });
              
              processedItems.push({
                ...item,
                processedImage: finalCanvas.toDataURL('image/jpeg', 0.95),
                processed: true
              });
            } catch (bgError) {
              // If background removal fails, use cropped image
              processedItems.push({
                ...item,
                processedImage: canvas.toDataURL('image/jpeg', 0.95),
                processed: false
              });
            }
          }
        } catch (error) {
          console.error(`Failed to process ${item.name}:`, error);
          processedItems.push({
            ...item,
            processedImage: URL.createObjectURL(imageFile),
            processed: false
          });
        }
      }
      
      resolve(processedItems);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
}

// Helper function to apply segmentation mask
async function applySegmentationMask(img, maskData, boundingBox) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Calculate crop area with padding
  const padding = 50;
  const centerX = (boundingBox.x / 100) * img.width;
  const centerY = (boundingBox.y / 100) * img.height;
  const width = (boundingBox.width / 100) * img.width + padding * 2;
  const height = (boundingBox.height / 100) * img.height + padding * 2;
  
  const cropX = Math.max(0, centerX - width / 2);
  const cropY = Math.max(0, centerY - height / 2);
  
  canvas.width = width;
  canvas.height = height;
  
  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // If we have mask data, apply it
  if (maskData) {
    // This is where we'd apply the actual mask
    // For now, just crop the area
    ctx.drawImage(
      img,
      cropX, cropY, width, height,
      0, 0, width, height
    );
  }
  
  return canvas.toDataURL('image/jpeg', 0.95);
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
              roomType: 'unknown'
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
          }
          
          const data = await response.json();
          
          if (data.success) {
            // Step 2: Process items with individual cropping and background removal
            console.log('Processing items individually...');
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
          
          // Better error handling for common issues
          let errorMessage = error.message;
          if (error.message.includes('overloaded_error') || error.message.includes('529')) {
            errorMessage = 'The AI service is currently overloaded. Please try again in a few moments.';
          } else if (error.message.includes('401')) {
            errorMessage = 'Authentication failed. Please check your API key.';
          }
          
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            text: `Error: ${errorMessage}` 
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