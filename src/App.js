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
          <li>Professional object isolation with SAM technology</li>
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

// Function to apply automatic segmentation mask from SAM

async function applyAutomaticSegmentationMask(canvas, maskData, boundingBox) {
  const ctx = canvas.getContext('2d');
  
  try {
    let maskSrc;
    
    // Handle different mask data structures
    if (typeof maskData === 'string' && maskData.startsWith('http')) {
      maskSrc = maskData;
      console.log('Mask is URL:', maskSrc);
    } else if (typeof maskData === 'object' && maskData.mask) {
      maskSrc = maskData.mask;
      console.log('Extracted mask from object:', maskSrc);
    } else if (typeof maskData === 'string') {
      maskSrc = maskData;
      console.log('Mask is string:', maskSrc);
    } else {
      console.error('Unknown mask data structure:', maskData);
      throw new Error('Unknown mask data structure');
    }
    
    console.log('Loading mask from:', maskSrc);
    
    // Load the mask image
    const maskImg = new Image();
    maskImg.crossOrigin = "anonymous";
    
    await new Promise((resolve, reject) => {
      maskImg.onload = () => {
        console.log('Mask image loaded:', maskImg.width, 'x', maskImg.height);
        resolve();
      };
      maskImg.onerror = (e) => {
        console.error('Failed to load mask from:', maskSrc);
        reject(new Error('Failed to load mask image'));
      };
      
      maskImg.src = maskSrc;
    });
    
    console.log('Mask loaded successfully');
    
    // DEBUG: Save the mask to see what it looks like
    const debugCanvas = document.createElement('canvas');
    debugCanvas.width = maskImg.width;
    debugCanvas.height = maskImg.height;
    const debugCtx = debugCanvas.getContext('2d');
    debugCtx.drawImage(maskImg, 0, 0);
    console.log('DEBUG - Mask preview:', debugCanvas.toDataURL('image/png').substring(0, 100));
    
    // Create a temporary canvas for the masked result
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the original image
    tempCtx.drawImage(canvas, 0, 0);
    
    // Apply the mask using destination-in compositing
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
    
    // Reset composite operation
    tempCtx.globalCompositeOperation = 'source-over';
    
    // DEBUG: Check what we have after masking
    const maskedPreview = tempCanvas.toDataURL('image/png').substring(0, 100);
    console.log('DEBUG - Masked result preview:', maskedPreview);
    
    // Get the bounds of the non-transparent area
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const bounds = getNonTransparentBounds(imageData.data, tempCanvas.width, tempCanvas.height);
    
    if (!bounds) {
      console.error('No object found in mask');
      throw new Error('No object found in mask');
    }
    
    console.log('Object bounds:', bounds);
    console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
    console.log('Bounds as percentage of canvas:', {
      x: (bounds.x / canvas.width * 100).toFixed(1) + '%',
      y: (bounds.y / canvas.height * 100).toFixed(1) + '%',
      width: (bounds.width / canvas.width * 100).toFixed(1) + '%',
      height: (bounds.height / canvas.height * 100).toFixed(1) + '%'
    });
    
    // Check if bounds are suspiciously large (might be the whole image)
    if (bounds.width > canvas.width * 0.9 || bounds.height > canvas.height * 0.9) {
      console.warn('WARNING: Bounds are very large, mask might not be working correctly');
    }
    
    // Create final canvas with proper dimensions
    const padding = 1.1; // 10% padding
    const paddedWidth = bounds.width * padding;
    const paddedHeight = bounds.height * padding;
    const finalSize = Math.max(paddedWidth, paddedHeight); // Square output
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.round(finalSize);
    finalCanvas.height = Math.round(finalSize);
    const finalCtx = finalCanvas.getContext('2d');
    
    // White background
    finalCtx.fillStyle = '#ffffff';
    finalCtx.fillRect(0, 0, finalSize, finalSize);
    
    // Add subtle shadow for professional look
    finalCtx.shadowColor = 'rgba(0, 0, 0, 0.1)';
    finalCtx.shadowBlur = 8;
    finalCtx.shadowOffsetX = 0;
    finalCtx.shadowOffsetY = 2;
    
    // Calculate centering offsets
    const offsetX = (finalSize - bounds.width) / 2;
    const offsetY = (finalSize - bounds.height) / 2;
    
    console.log('Drawing from tempCanvas:', bounds.x, bounds.y, bounds.width, bounds.height);
    console.log('Drawing to finalCanvas at:', offsetX, offsetY);
    
    // Draw ONLY the masked object (not the full image!)
    finalCtx.drawImage(
      tempCanvas,  // Use the masked canvas, not the original
      bounds.x, bounds.y, bounds.width, bounds.height,  // Source rectangle (cropped area)
      offsetX, offsetY, bounds.width, bounds.height    // Destination rectangle (centered)
    );
    
    // Reset shadow
    finalCtx.shadowColor = 'transparent';
    finalCtx.shadowBlur = 0;
    
    const finalResult = finalCanvas.toDataURL('image/jpeg', 0.95);
    console.log('DEBUG - Final result preview:', finalResult.substring(0, 100));
    
    return finalResult;
    
  } catch (error) {
    console.error('Error applying automatic mask:', error);
    return null;
  }
}

// Helper function to get non-transparent bounds from image data
function getNonTransparentBounds(imageData, width, height) {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let hasContent = false;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = imageData[idx + 3];
      
      if (alpha > 10) { // Threshold for non-transparent
        hasContent = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasContent) return null;
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

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
        ✨ Good news: Professional object isolation with SAM technology!
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

const ItemCard = ({ item, index, onEdit, onRemove }) => {
  const handleEdit = (e) => {
    e.stopPropagation();
    console.log('Edit clicked - opening edit modal for index:', index);
    onEdit(index);
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    onRemove(index);
  };

  const handleList = (e) => {
    e.stopPropagation();
    alert(`Listed: ${item.name} for ${Number(item.value).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 })}`);
  };

  return (
    <div className="item-card">
      <button 
        className="remove-btn"
        onClick={handleRemove}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'rgba(255, 255, 255, 0.9)',
          color: '#ff4444',
          border: 'none',
          borderRadius: '50%',
          width: 28,
          height: 28,
          cursor: 'pointer',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          transition: 'all 0.2s ease'
        }}
        onMouseOver={(e) => {
          e.target.style.background = '#ff4444';
          e.target.style.color = 'white';
        }}
        onMouseOut={(e) => {
          e.target.style.background = 'rgba(255, 255, 255, 0.9)';
          e.target.style.color = '#ff4444';
        }}
      >
        ×
      </button>
      
      <div className="w-full aspect-square overflow-hidden rounded-lg bg-gray-100">
        <img
          src={item.croppedImage || item.processedImage || item.stagedImage || ''}
          alt={item.name || 'Detected item'}
          className="w-full h-full object-cover rounded"
          onError={(e) => {
            e.target.src = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20viewBox%3D%220%200%20100%20100%22%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20fill%3D%22%23f0f0f0%22%2F%3E%3Ctext%20x%3D%2250%22%20y%3D%2250%22%20text-anchor%3D%22middle%22%20dy%3D%22.3em%22%20fill%3D%22%23999%22%20font-family%3D%22sans-serif%22%20font-size%3D%2214%22%3ENo%20Image%3C%2Ftext%3E%3C%2Fsvg%3E';
          }}
        />
      </div>
      
      <div className="item-details">
        <h3 className="item-name">
          {item.name}
          {item.confidence && (
            <span className="confidence-badge">
              {Math.round(item.confidence)}%
            </span>
          )}
        </h3>
        
        <div className="item-price">
          {(item.value ?? 0).toFixed(2)}
        </div>
        
        {item.condition && (
          <span className="item-condition">
            {item.condition}
          </span>
        )}
        
        <p className="item-description">
          {item.description || `${item.condition || 'Good'} condition ${item.name ? item.name.toLowerCase() : 'item'}. Well-maintained and ready for immediate use.`}
        </p>
        
        <div className="item-actions">
          <button 
            className="btn btn-outline"
            onClick={handleEdit}
          >
            <span>Edit</span>
          </button>
          <button 
            className="btn btn-primary"
            onClick={handleList}
          >
            <span>List Item</span>
          </button>
        </div>
      </div>
    </div>
  );
};

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
    alert(`Listed: ${item.name} for ${Number(item.value).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 })}`);
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
    alert(`Ready to list all ${items.length} items! Total value: ${totalValue.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 })}`);
  };
  
  return (
    <div className="inventory-results">
      <div className="total-value">
        <h3>Total Estimated Value</h3>
        <div className="amount">
          ${totalValue.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 })}
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


// Updated function to handle segmentation masks from backend
async function processItemsLocally(items, imageFile, onProgress) {
  const img = new Image();
  
  return new Promise((resolve) => {
    img.onload = async () => {
      const processedItems = [];
      
      // Log image dimensions for debugging
      console.log(`Processing image with dimensions: ${img.width}x${img.height}`);
      
      // Create a temporary canvas for the full image
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = img.width;
      fullCanvas.height = img.height;
      const fullCtx = fullCanvas.getContext('2d');
      fullCtx.drawImage(img, 0, 0);
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress(i + 1, items.length, item.name);
        
        try {
          // Skip if item is invalid
          if (!item || !item.boundingBox || typeof item.boundingBox.x === 'undefined') {
            console.error('Invalid item structure:', item);
            processedItems.push({
              ...item,
              name: item?.name || 'Unknown Item',
              processedImage: URL.createObjectURL(imageFile),
              processed: false,
              error: 'Invalid item structure'
            });
            continue;
          }
          
          console.log(`Processing item ${i + 1}/${items.length}: ${item.name}`);
          console.log(`Bounding box:`, item.boundingBox);
          
          // If we have a segmentation mask from the backend, use it
          if (item.hasSegmentation && item.segmentationMask) {
            console.log(`Using SAM automatic segmentation for ${item.name}`);
            try {
              // Create canvas for the full image
              const fullCanvas = document.createElement('canvas');
              fullCanvas.width = img.width;
              fullCanvas.height = img.height;
              const fullCtx = fullCanvas.getContext('2d');
              fullCtx.drawImage(img, 0, 0);
              
              // Apply the automatic mask
              const isolatedImage = await applyAutomaticSegmentationMask(
                fullCanvas, 
                item.segmentationMask, 
                item.boundingBox
              );
              
              if (isolatedImage) {
                // Create a new image to ensure the data URL is loaded
                const tempImg = new Image();
                const imgLoadPromise = new Promise((resolve) => {
                  tempImg.onload = resolve;
                  tempImg.onerror = () => {
                    console.error('Failed to load processed image');
                    resolve(null);
                  };
                });
                tempImg.src = isolatedImage;
                await imgLoadPromise;
                
                if (tempImg.complete && tempImg.naturalWidth > 0) {
                  processedItems.push({
                    ...item,
                    processedImage: isolatedImage,
                    processed: true
                  });
                  console.log(`Successfully applied automatic mask for ${item.name}`);
                  continue;
                } else {
                  console.log('Processed image failed to load, falling back to simple cropping');
                }
              } else {
                console.log('No isolated image returned from segmentation');
              }
            } catch (segError) {
              console.error(`Automatic segmentation failed for ${item.name}:`, segError);
              // Continue to fallback cropping
            }
          }
          
          // Fallback to simple cropping if no segmentation or if it failed
          console.log(`Using simple cropping for ${item.name}`);

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          // Calculate crop area with slightly larger padding for fallback (10% instead of 5%)
          const padding = 0.1; // Slightly more padding for non-masked items
          const centerX = (item.boundingBox.x / 100) * img.width;
          const centerY = (item.boundingBox.y / 100) * img.height;
          const boxWidth = (item.boundingBox.width / 100) * img.width;
          const boxHeight = (item.boundingBox.height / 100) * img.height;

          // Calculate crop area with padding
          const padX = boxWidth * padding;
          const padY = boxHeight * padding;

          const cropX = Math.max(0, Math.floor(centerX - boxWidth/2 - padX));
          const cropY = Math.max(0, Math.floor(centerY - boxHeight/2 - padY));
          const cropWidth = Math.min(
            Math.ceil(boxWidth + 2 * padX), 
            img.width - cropX
          );
          const cropHeight = Math.min(
            Math.ceil(boxHeight + 2 * padY), 
            img.height - cropY
          );

          // Skip if crop area is invalid
          if (cropWidth <= 0 || cropHeight <= 0) {
            console.error(`Invalid crop dimensions for ${item.name}: ${cropWidth}x${cropHeight}`);
            processedItems.push({
              ...item,
              processedImage: URL.createObjectURL(imageFile),
              processed: false,
              error: 'Invalid crop dimensions'
            });
            continue;
          }

          // Make canvas square to match the segmented items
          const maxDim = Math.max(cropWidth, cropHeight);
          canvas.width = maxDim;
          canvas.height = maxDim;

          // Pure white background
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Add subtle shadow for consistency
          ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2;

          // Center the cropped image in the square canvas
          const offsetX = (maxDim - cropWidth) / 2;
          const offsetY = (maxDim - cropHeight) / 2;

          // Draw the cropped portion centered
          try {
            ctx.drawImage(
              img,
              cropX, cropY, cropWidth, cropHeight,
              offsetX, offsetY, cropWidth, cropHeight
            );
            
            const processedImageUrl = canvas.toDataURL('image/jpeg', 0.95);
            processedItems.push({
              ...item,
              processedImage: processedImageUrl,
              processed: true,
              cropInfo: { cropX, cropY, cropWidth, cropHeight }
            });
            
            // Debug log the processed image URL
            console.log(`Item ${item.name || 'unnamed'} processed image preview:`, 
              processedImageUrl.substring(0, 50) + '...');
            
          } catch (drawError) {
            console.error(`Error drawing ${item.name}:`, drawError);
            processedItems.push({
              ...item,
              processedImage: URL.createObjectURL(imageFile),
              processed: false,
              error: drawError.message
            });
          }
          
        } catch (error) {
          console.error(`Failed to process ${item.name}:`, error);
          processedItems.push({
            ...item,
            processedImage: URL.createObjectURL(imageFile),
            processed: false,
            error: error.message
          });
        }
      }
      
      // Clean up object URL
      URL.revokeObjectURL(img.src);
      console.log(`Finished processing ${processedItems.length} items`);
      resolve(processedItems);
    };
    
    img.onerror = (error) => {
      console.error('Failed to load image:', error);
      resolve(items.map(item => ({
        ...item,
        processedImage: URL.createObjectURL(imageFile),
        processed: false,
        error: 'Failed to load image'
      })));
    };
    
    // Load the image
    img.src = URL.createObjectURL(imageFile);
  });
}

async function applySegmentationMask(img, maskData, boundingBox) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  try {
    if (!img || !boundingBox) {
      throw new Error('Invalid input: missing image or bounding box');
    }

    // Convert percentage coordinates to pixels
    const centerX = (boundingBox.x / 100) * img.width;
    const centerY = (boundingBox.y / 100) * img.height;
    const boxWidth = (boundingBox.width / 100) * img.width;
    const boxHeight = (boundingBox.height / 100) * img.height;
    
    // Calculate padding (15% of box size)
    const padX = boxWidth * 0.15;
    const padY = boxHeight * 0.15;

    // Calculate crop area with padding
    const cropX = Math.max(0, Math.floor(centerX - boxWidth / 2 - padX));
    const cropY = Math.max(0, Math.floor(centerY - boxHeight / 2 - padY));
    const cropWidth = Math.min(Math.ceil(boxWidth + 2 * padX), img.width - cropX);
    const cropHeight = Math.min(Math.ceil(boxHeight + 2 * padY), img.height - cropY);

    if (cropWidth <= 0 || cropHeight <= 0) {
      throw new Error(`Invalid crop dimensions: ${cropWidth}x${cropHeight}`);
    }

    // Set canvas size to match crop area
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    // Draw original image into cropped area
    ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    // Apply mask if available
    if (maskData) {
      const maskImg = new Image();
      const maskLoaded = new Promise((resolve, reject) => {
        maskImg.onload = resolve;
        maskImg.onerror = () => reject(new Error('Failed to load mask image'));
      });
      maskImg.src = maskData;
      await maskLoaded;

      // Apply mask using destination-in to show only the masked area
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskImg, 0, 0, cropWidth, cropHeight);
      ctx.globalCompositeOperation = 'source-over';
    }

    // Get non-transparent bounds for tight cropping
    const croppedData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = getNonTransparentBounds(croppedData.data, canvas.width, canvas.height);

    // Final square canvas output
    const squareSize = Math.max(bounds.width, bounds.height);
    const squareCanvas = document.createElement('canvas');
    squareCanvas.width = squareSize;
    squareCanvas.height = squareSize;
    const squareCtx = squareCanvas.getContext('2d');

    // White background
    squareCtx.fillStyle = '#ffffff';
    squareCtx.fillRect(0, 0, squareSize, squareSize);

    // Draw image centered
    squareCtx.drawImage(
      canvas,
      bounds.x, bounds.y, bounds.width, bounds.height,
      (squareSize - bounds.width) / 2,
      (squareSize - bounds.height) / 2,
      bounds.width, bounds.height
    );

    return squareCanvas.toDataURL('image/jpeg', 0.95);
  } catch (error) {
    console.error('Error in applySegmentationMask:', error);
    return null;
  }
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
      console.log('Selected file:', file.name, file.size, file.type);
      setSelectedImage(file);
      
      // Create a preview URL for debugging
      const previewUrl = URL.createObjectURL(file);
      console.log('Preview URL:', previewUrl);
      
      // Load the image to check dimensions
      const img = new Image();
      img.onload = () => {
        console.log('Image dimensions:', img.width, 'x', img.height);
      };
      img.onerror = () => console.error('Failed to load image');
      img.src = previewUrl;
      
      sendMessage('Analyze this room for sellable items', file);
    }
  };
  
  const sendMessage = async (text, imageFile) => {
    console.log('Starting message send with image:', imageFile?.name);
    const apiKey = localStorage.getItem(API_KEY_STORAGE);
    if (!apiKey) {
      console.error('No API key found');
      setHasApiKey(false);
      return;
    }
    
    setMessages(prev => [...prev, { role: 'user', text, image: imageFile }]);
    setIsLoading(true);
    
    const processImage = async () => {
      if (!imageFile) {
        setIsLoading(false);
        return;
      }

      console.log('Processing image file:', imageFile.name, imageFile.size, imageFile.type);
      const reader = new FileReader();
      
      try {
        // First, try to load and validate the image
        const imageLoadPromise = new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = (e) => reject(new Error('Failed to load image'));
          img.src = URL.createObjectURL(imageFile);
        });
        
        const img = await imageLoadPromise;
        console.log('Image loaded successfully:', img.width, 'x', img.height);
        
        // Read the file as base64
        const base64 = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result.split(',')[1]);
          reader.onerror = (e) => reject(new Error('Failed to read image data'));
          reader.readAsDataURL(imageFile);
        });
        
        if (!base64) {
          throw new Error('Failed to convert image to base64');
        }
        
        // Make API call
        const endpoint = API_URL + (API_URL.endsWith('/api') ? '/analyze-simple' : '/api/analyze-simple');
        console.log('Sending request to:', endpoint);
        
        // Hard-coded location for Calgary
        const userLocation = "Calgary, Canada"; // Hard-coded for now
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64,
            location: userLocation,
            roomType: 'unknown'
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Backend response:', data);
        
        if (!data.success) {
          throw new Error(data.error || 'Analysis failed');
        }
        
        // Validate items array
        if (!data.items || !Array.isArray(data.items)) {
          throw new Error('Invalid response: missing items array');
        }
        
        // Update items and total value
        setItems(data.items || []);
        setTotalValue(data.totalValue || 0);
        
        // Process items with individual cropping and background removal
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
        
      } catch (error) {
        console.error('Error processing image:', error);
        setProcessingStatus(null);
        
        let errorMessage = 'An error occurred while processing the image.';
        if (error.message.includes('overloaded') || error.message.includes('529')) {
          errorMessage = 'The AI service is currently overloaded. Please try again in a few moments.';
        } else if (error.message.includes('401')) {
          errorMessage = 'Authentication failed. Please check your API key.';
        } else if (error.message.includes('Failed to load image')) {
          errorMessage = 'The image could not be loaded. It may be corrupted or in an unsupported format.';
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        }
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          text: `Error: ${errorMessage}` 
        }]);
      } finally {
        setIsLoading(false);
      }
    };
    
    // Start processing
    processImage().catch(error => {
      console.error('Unhandled error in processImage:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        text: 'An unexpected error occurred. Please try again.' 
      }]);
    });
    
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
                      <img 
                        src={msg.thumbnail ? URL.createObjectURL(msg.thumbnail) : URL.createObjectURL(msg.image)} 
                        alt="Uploaded" 
                        className="item-image"
                      />
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
