import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { SpeedInsights } from "@vercel/speed-insights/react";

// Utility functions
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001'
  : '/api';

const API_KEY_STORAGE = 'pyckit_api_key';

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
  return (
    <div className="detailed-item-card">
      <div className="item-badge"></div>
      <div className="item-image-wrapper">
        <img 
          src={item.processedImage || item.stagedImage} 
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

const ImageAnalysis = ({ analysisData, imageFile }) => {
  const [showAllItems, setShowAllItems] = useState(false);
  const visibleItems = showAllItems ? analysisData.items : analysisData.items.slice(0, 3);
  
  const handleViewListing = (item) => {
    console.log('View listing for:', item.name);
    // Add your listing logic here
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
      
      {/* Total Value Card */}
      <div className="value-summary-card">
        <h3>Total estimated value</h3>
        <div className="total-value-amount">
          ${analysisData.totalValue.toLocaleString('en-CA')}
        </div>
      </div>
      
      {/* List All Items Button */}
      <button className="list-all-button">
        List all items ({analysisData.items.length})
      </button>
      
      {/* Sellable Items Section */}
      <div className="items-section">
        <h3 className="items-title">
          <span className="icon">🏠</span> Your Sellable Items
        </h3>
        
        <div className="detailed-items-grid">
          {visibleItems.map((item, index) => (
            <ItemCard 
              key={index} 
              item={item} 
              onViewListing={handleViewListing}
            />
          ))}
        </div>
        
        {!showAllItems && analysisData.items.length > 3 && (
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

const ErrorModal = ({ error, onClose }) => {
  return (
    <div className="error-overlay">
      <div className="error-modal">
        <div className="error-icon">⚠️</div>
        <h2>Critical Error</h2>
        <p className="error-message">{error}</p>
        <button className="error-close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

// STRICT SAM segmentation - NO FALLBACKS
async function applySegmentationMask(img, maskData, cropCoords) {
  return new Promise((resolve, reject) => {
    if (!maskData || !cropCoords) {
      reject(new Error('Missing mask data or crop coordinates'));
      return;
    }
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    const maskImg = new Image();
    
    maskImg.onload = () => {
      try {
        const { x1, y1, x2, y2 } = cropCoords;
        const cropWidth = x2 - x1;
        const cropHeight = y2 - y1;
        
        // Validate dimensions
        if (cropWidth <= 0 || cropHeight <= 0) {
          throw new Error(`Invalid crop dimensions: ${cropWidth}x${cropHeight}`);
        }
        
        // Create square canvas
        const size = Math.max(cropWidth, cropHeight) * 1.2;
        canvas.width = size;
        canvas.height = size;
        
        // Pure white background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        
        // Center the object
        const offsetX = (size - cropWidth) / 2;
        const offsetY = (size - cropHeight) / 2;
        
        // Draw the cropped area
        ctx.drawImage(
          img,
          x1, y1, cropWidth, cropHeight,
          offsetX, offsetY, cropWidth, cropHeight
        );
        
        // Create a temporary canvas for the mask
        const maskCanvas = document.createElement('canvas');
        const maskCtx = maskCanvas.getContext('2d');
        maskCanvas.width = cropWidth;
        maskCanvas.height = cropHeight;
        maskCtx.drawImage(maskImg, 0, 0, cropWidth, cropHeight);
        
        // Apply the mask
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, offsetX, offsetY);
        
        // Ensure white background
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        
        const result = canvas.toDataURL('image/jpeg', 0.95);
        resolve(result);
      } catch (error) {
        reject(new Error(`Mask application failed: ${error.message}`));
      }
    };
    
    maskImg.onerror = () => {
      reject(new Error('Failed to load mask image data'));
    };
    
    maskImg.src = maskData;
  });
}

// STRICT processing - NO FALLBACKS
async function processItemsLocally(items, imageFile, imageDimensions, onProgress) {
  const img = new Image();
  
  return new Promise((resolve, reject) => {
    img.onload = async () => {
      const processedItems = [];
      const errors = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress(i + 1, items.length, item.name);
        
        try {
          // STRICT REQUIREMENT: Must have SAM segmentation
          if (!item.hasSegmentation) {
            throw new Error(`No SAM segmentation flag for ${item.name}`);
          }
          
          if (!item.segmentationMask) {
            throw new Error(`No segmentation mask data for ${item.name}`);
          }
          
          if (!item.cropCoords) {
            throw new Error(`No crop coordinates for ${item.name}`);
          }
          
          console.log(`Processing ${item.name} with SAM segmentation...`);
          
          const processedImage = await applySegmentationMask(
            img,
            item.segmentationMask,
            item.cropCoords
          );
          
          if (!processedImage) {
            throw new Error(`SAM processing returned null for ${item.name}`);
          }
          
          processedItems.push({
            ...item,
            processedImage,
            processed: true
          });
          
          console.log(`✓ Successfully processed ${item.name}`);
          
        } catch (error) {
          console.error(`CRITICAL ERROR processing ${item.name}:`, error);
          errors.push(`${item.name}: ${error.message}`);
        }
      }
      
      // If ANY errors occurred, fail the entire batch
      if (errors.length > 0) {
        reject(new Error(`SAM processing failed for ${errors.length} items:\n\n${errors.join('\n')}`));
        return;
      }
      
      resolve(processedItems);
    };
    
    img.onerror = (error) => {
      console.error('Failed to load image:', error);
      reject(new Error('Failed to load source image for processing'));
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
  const [error, setError] = useState(null);
  
  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentImage(file);
      await analyzeImage(file);
    }
  };
  
  const analyzeImage = async (imageFile) => {
    setIsLoading(true);
    setError(null);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      
      try {
        const endpoint = API_URL + (API_URL.endsWith('/api') ? '/analyze-simple' : '/api/analyze-simple');
        
        console.log('Sending image for analysis...');
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
          throw new Error(`Server error (${response.status}): ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Received analysis data:', data);
        
        if (!data.success) {
          throw new Error(data.error || 'Analysis failed');
        }
        
        // STRICT VALIDATION: Ensure ALL items have SAM segmentation
        if (!data.items || !Array.isArray(data.items)) {
          throw new Error('Invalid response: missing items array');
        }
        
        const itemsWithoutSegmentation = data.items.filter(item => !item.hasSegmentation);
        if (itemsWithoutSegmentation.length > 0) {
          const names = itemsWithoutSegmentation.map(i => i.name).join(', ');
          throw new Error(`Backend failed to provide SAM segmentation for ${itemsWithoutSegmentation.length} items: ${names}`);
        }
        
        console.log(`All ${data.items.length} items have SAM segmentation. Processing...`);
        setProcessingStatus({ current: 0, total: data.items.length });
        
        try {
          const processedItems = await processItemsLocally(
            data.items,
            imageFile,
            data.imageDimensions,
            (current, total, itemName) => {
              setProcessingStatus({ current, total, currentItem: itemName });
            }
          );
          
          setProcessingStatus(null);
          console.log('Successfully processed all items!');
          
          setAnalysisResult({
            ...data,
            items: processedItems,
            imageFile
          });
          
        } catch (processingError) {
          // Processing failed - this is critical
          console.error('CRITICAL: Item processing failed', processingError);
          setProcessingStatus(null);
          setError(processingError.message);
        }
        
      } catch (error) {
        console.error('Analysis error:', error);
        setProcessingStatus(null);
        setError(error.message);
      }
      
      setIsLoading(false);
    };
    
    reader.onerror = () => {
      setError('Failed to read image file');
      setIsLoading(false);
    };
    
    reader.readAsDataURL(imageFile);
  };
  
  return (
    <div className="app-container">
      {!analysisResult ? (
        <WelcomeScreen onFileSelect={handleFileSelect} />
      ) : (
        <ImageAnalysis analysisData={analysisResult} imageFile={currentImage} />
      )}
      
      {processingStatus && (
        <div className="processing-overlay">
          <div className="processing-modal">
            <h3>Processing Items...</h3>
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
      
      {error && (
        <ErrorModal 
          error={error} 
          onClose={() => {
            setError(null);
            setAnalysisResult(null);
            setCurrentImage(null);
          }} 
        />
      )}
      
      <SpeedInsights />
    </div>
  );
}