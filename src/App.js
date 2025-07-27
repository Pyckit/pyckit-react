import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { SpeedInsights } from "@vercel/speed-insights/react";

// Utility functions
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001'
  : '/api';

// Client-side isolation function
async function createBasicIsolation(img, boundingBox) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Calculate crop area
    const { x, y, width, height } = boundingBox;
    const padding = 1.3;
    const imgW = img.width;
    const imgH = img.height;
    
    const boxW = (width / 100 * imgW) * padding;
    const boxH = (height / 100 * imgH) * padding;
    const cropX = Math.max(0, (x / 100 * imgW) - boxW / 2);
    const cropY = Math.max(0, (y / 100 * imgH) - boxH / 2);
    
    // Make square canvas
    const size = Math.max(boxW, boxH);
    canvas.width = size;
    canvas.height = size;
    
    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    
    // Center the crop
    const offsetX = (size - boxW) / 2;
    const offsetY = (size - boxH) / 2;
    
    // Draw image
    ctx.drawImage(
      img,
      cropX, cropY, boxW, boxH,
      offsetX, offsetY, boxW, boxH
    );
    
    // Apply vignette/fade effect for soft edges
    const gradient = ctx.createRadialGradient(
      size/2, size/2, size * 0.3,
      size/2, size/2, size * 0.5
    );
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.8)');
    
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    // Add back white background
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    
    resolve(canvas.toDataURL('image/jpeg', 0.95));
  });
}

// Components
const WelcomeScreen = ({ onFileSelect }) => {
  const fileInputRef = useRef(null);
  
  return (
    <div className="welcome-container">
      <div className="logo-header">
        <img src="/pyckit-logo.png" alt="Pyckit" className="main-logo" />
        <h1>Pyckit Vision AI ▼</h1>
      </div>
      
      <button className="upload-button" onClick={() => fileInputRef.current?.click()}>
        + Upload a photo
      </button>
      
      <div className="quality-info">
        <h3>How it works:</h3>
        <div className="quality-tiers">
          <div className="tier">
            <span className="tier-icon">⚡</span>
            <strong>Instant Results</strong>
            <p>Basic isolation available immediately</p>
          </div>
          <div className="tier">
            <span className="tier-icon">✨</span>
            <strong>Enhanced Quality</strong>
            <p>Professional isolation in 2-5 minutes</p>
          </div>
        </div>
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

const ItemCard = ({ item, onViewListing }) => {
  const [enhancedImage, setEnhancedImage] = useState(null);
  
  return (
    <div className="detailed-item-card">
      <div className="item-badge"></div>
      {item.processingStatus === 'queued' && !enhancedImage && (
        <div className="processing-indicator">
          <div className="spinner-small" />
          <span>Enhancing...</span>
        </div>
      )}
      <div className="item-image-wrapper">
        <img 
          src={enhancedImage || item.processedImage} 
          alt={item.name}
          className="detailed-item-image"
        />
      </div>
      <div className="item-details-section">
        <h3 className="item-title">{item.name}</h3>
        <div className="item-price">${item.value}</div>
        <div className="item-metadata">
          <p><strong>Condition:</strong> {item.condition}</p>
          <p><strong>Description:</strong> {item.description}</p>
          <p><strong>Best time:</strong> Year-round</p>
        </div>
        <div className="item-confidence">
          {item.confidence}% match
        </div>
        <button 
          className="view-listing-btn"
          onClick={() => onViewListing(item)}
        >
          VIEW LISTING
        </button>
      </div>
    </div>
  );
};

const ImageAnalysis = ({ analysisData, imageFile, queueId }) => {
  const [items, setItems] = useState(analysisData.items);
  const [showAllItems, setShowAllItems] = useState(false);
  const [enhancementStatus, setEnhancementStatus] = useState('processing');
  const checkIntervalRef = useRef(null);
  
  const visibleItems = showAllItems ? items : items.slice(0, 3);
  
  // Poll for enhanced images
  useEffect(() => {
    if (!queueId) return;
    
    const checkStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/check-status?queueId=${queueId}`);
        const data = await response.json();
        
        if (data.success && data.processedItems) {
          // Update items with enhanced masks
          const updatedItems = items.map(item => {
            const processed = data.processedItems.find(p => p.itemId === item.id);
            if (processed && processed.mask) {
              return {
                ...item,
                enhancedMask: processed.mask,
                cropCoords: processed.cropCoords,
                processingStatus: 'enhanced'
              };
            }
            return item;
          });
          
          setItems(updatedItems);
          
          // Apply enhanced isolation
          updatedItems.forEach(async (item) => {
            if (item.enhancedMask && !item.enhancedImage) {
              const enhanced = await applyEnhancedMask(imageFile, item.enhancedMask, item.cropCoords);
              setItems(prev => prev.map(i => 
                i.id === item.id ? { ...i, enhancedImage: enhanced } : i
              ));
            }
          });
          
          // Stop polling if complete
          if (data.status === 'completed') {
            setEnhancementStatus('completed');
            clearInterval(checkIntervalRef.current);
          }
        }
      } catch (error) {
        console.error('Failed to check status:', error);
      }
    };
    
    // Check immediately, then every 5 seconds
    checkStatus();
    checkIntervalRef.current = setInterval(checkStatus, 5000);
    
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [queueId, items, imageFile]);
  
  const handleViewListing = (item) => {
    console.log('View listing for:', item.name);
  };
  
  return (
    <div className="analysis-container">
      <h2 className="section-title">Current Analysis</h2>
      
      {/* Original Image Display */}
      <div className="original-image-section">
        <p className="analysis-label">Analyze this room for sellable items</p>
        <div className="original-image-container">
          <img 
            src={URL.createObjectURL(imageFile)} 
            alt="Room analysis" 
            className="original-image"
          />
        </div>
      </div>
      
      {/* Enhancement Status */}
      {queueId && enhancementStatus === 'processing' && (
        <div className="enhancement-banner">
          <div className="enhancement-content">
            <div className="spinner-small" />
            <span>Enhancing images with professional isolation...</span>
          </div>
        </div>
      )}
      
      {/* Total Value Card */}
      <div className="value-summary-card">
        <h3>Total estimated value</h3>
        <div className="total-value-amount">
          ${analysisData.totalValue.toLocaleString('en-CA')}
        </div>
      </div>
      
      {/* List All Items Button */}
      <button className="list-all-button">
        List all items ({items.length})
      </button>
      
      {/* Sellable Items Section */}
      <div className="items-section">
        <h3 className="items-title">
          <span className="icon">🏠</span> Your Sellable Items
        </h3>
        
        <div className="detailed-items-grid">
          {visibleItems.map((item, index) => (
            <ItemCard 
              key={item.id || index} 
              item={item} 
              onViewListing={handleViewListing}
            />
          ))}
        </div>
        
        {!showAllItems && items.length > 3 && (
          <div className="load-more-section">
            <div className="separator-line">
              <span className="separator-text">
                Upload a room photo to discover unique items...
              </span>
            </div>
            <button 
              className="load-more-btn"
              onClick={() => setShowAllItems(true)}
            >
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Apply enhanced mask when available
async function applyEnhancedMask(imageFile, maskData, cropCoords) {
  return new Promise((resolve) => {
    const img = new Image();
    const maskImg = new Image();
    
    img.onload = () => {
      maskImg.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const { x1, y1, x2, y2 } = cropCoords;
        const cropWidth = x2 - x1;
        const cropHeight = y2 - y1;
        
        // Square canvas
        const size = Math.max(cropWidth, cropHeight) * 1.2;
        canvas.width = size;
        canvas.height = size;
        
        // White background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        
        // Center the object
        const offsetX = (size - cropWidth) / 2;
        const offsetY = (size - cropHeight) / 2;
        
        // Draw cropped area
        ctx.drawImage(
          img,
          x1, y1, cropWidth, cropHeight,
          offsetX, offsetY, cropWidth, cropHeight
        );
        
        // Apply mask
        const maskCanvas = document.createElement('canvas');
        const maskCtx = maskCanvas.getContext('2d');
        maskCanvas.width = cropWidth;
        maskCanvas.height = cropHeight;
        maskCtx.drawImage(maskImg, 0, 0, cropWidth, cropHeight);
        
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, offsetX, offsetY);
        
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      maskImg.src = maskData;
    };
    img.src = URL.createObjectURL(imageFile);
  });
}

// Process items with basic isolation first
async function processItemsLocally(items, imageFile, onProgress) {
  const img = new Image();
  
  return new Promise((resolve) => {
    img.onload = async () => {
      const processedItems = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress(i + 1, items.length, item.name);
        
        try {
          // Create basic isolation immediately
          const processedImage = await createBasicIsolation(img, item.boundingBox);
          
          processedItems.push({
            ...item,
            processedImage,
            processed: true
          });
          
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

// Main App Component
export default function App() {
  const [analysisResult, setAnalysisResult] = useState(null);
  const [currentImage, setCurrentImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [queueId, setQueueId] = useState(null);
  
  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentImage(file);
      await analyzeImage(file);
    }
  };
  
  const analyzeImage = async (imageFile) => {
    setIsLoading(true);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      
      try {
        const endpoint = API_URL + (API_URL.endsWith('/api') ? '/analyze-simple' : '/api/analyze-simple');
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64,
            roomType: 'unknown',
            userId: localStorage.getItem('pyckit_user_id') || 'anonymous',
            userTier: 'free' // Change based on user subscription
          })
        });
        
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
          setQueueId(data.queueId);
          setProcessingStatus({ current: 0, total: data.items.length });
          
          // Process with basic isolation first
          const processedItems = await processItemsLocally(
            data.items,
            imageFile,
            (current, total, itemName) => {
              setProcessingStatus({ current, total, currentItem: itemName });
            }
          );
          
          setProcessingStatus(null);
          
          setAnalysisResult({
            ...data,
            items: processedItems,
            imageFile
          });
          
        } else {
          throw new Error(data.error || 'Analysis failed');
        }
      } catch (error) {
        console.error('Analysis error:', error);
        setProcessingStatus(null);
        alert(`Error: ${error.message}`);
      }
      
      setIsLoading(false);
    };
    
    reader.readAsDataURL(imageFile);
  };
  
  return (
    <div className="app-container">
      {!analysisResult ? (
        <WelcomeScreen onFileSelect={handleFileSelect} />
      ) : (
        <ImageAnalysis 
          analysisData={analysisResult} 
          imageFile={currentImage}
          queueId={queueId}
        />
      )}
      
      {processingStatus && (
        <div className="processing-overlay">
          <div className="processing-modal">
            <h3>Creating Basic Isolation...</h3>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${(processingStatus.current / processingStatus.total) * 100}%` }}
              />
            </div>
            <p>Processing item {processingStatus.current} of {processingStatus.total}</p>
            {processingStatus.currentItem && (
              <p className="processing-item">{processingStatus.currentItem}</p>
            )}
          </div>
        </div>
      )}
      
      {isLoading && !processingStatus && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
        </div>
      )}
      
      <SpeedInsights />
    </div>
  );
}