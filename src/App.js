// SPECIAL HANDLING FOR KNOWN MISALIGNMENTS
        // If this is a floor lamp with coordinates on the left side, it might be misidentified
        if (itemNameLower.includes('lamp') && item.boundingBox.x < 40) {
          console.log('⚠️ WARNING: Floor lamp detected on LEFT side - this might be incorrect!');
          console.log('The actual floor lamp is likely on the RIGHT side of the image.');
          
          // Check if there's another tall object on the right that might be the real lamp
          // For now, let's draw the box where Claude says it is, but highlight the issue
          boxColor = '#FF0000'; // Bright red for suspected misidentification
        }import React, { useState, useRef, useEffect } from 'react';
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
          <li>Our AI identifies all sellable items with bounding boxes</li>
          <li>Get Calgary market prices for each item</li>
          <li>Edit listings and export individual items</li>
          <li>Discover your room's hidden value!</li>
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

const ItemCard = ({ item, index, onHighlight, onRemove }) => (
  <div className="item-card" onClick={() => onHighlight(index)}>
    <button className="remove-item-btn" onClick={(e) => { e.stopPropagation(); onRemove(index); }}>
      ×
    </button>
    <img className="item-thumbnail-large" id={`item-thumbnail-${index}`} alt={item.name} />
    <div className="item-name">{item.name}</div>
    <div className="item-value">{item.value}</div>
    <div className="item-details">
      <p><strong>Condition:</strong> {item.condition}</p>
      <p><strong>Description:</strong> {item.description || `${item.condition || 'Good'} condition ${item.name.toLowerCase()}. Well-maintained and ready for immediate use.`}</p>
      <p><strong>Best time:</strong> {item.bestSeason || 'August-September (student moving season)'}</p>
    </div>
    <span className="confidence-badge">{item.confidence}% match</span>
  </div>
);

const ItemEditor = ({ item, index, onList, showProcessAll }) => {
  const [title, setTitle] = useState(item.listingTitle || item.name);
  const [price, setPrice] = useState(parseFloat(String(item.value).replace(/[^0-9.-]+/g, '')) || 0);
  const [condition, setCondition] = useState(item.condition || 'Good');
  
  // Generate a more detailed default description
  const generateDetailedDescription = () => {
    const baseDesc = item.description || '';
    if (baseDesc.length > 100) return baseDesc; // Already very detailed
    
    // Extract brand if present in name
    const itemLower = item.name.toLowerCase();
    const hasBrand = itemLower.includes('ikea') || itemLower.includes('malm') || 
                     itemLower.includes('hemnes') || itemLower.includes('kallax');
    
    // Start with condition and full name
    let enhanced = `${condition} condition ${item.name}`;
    
    // Add material details if mentioned
    if (item.name.includes('Oak Veneer') || item.name.includes('oak veneer')) {
      enhanced = enhanced.replace('Oak Veneer', '(oak veneer)');
    }
    
    // Add specific details based on item type
    if (itemLower.includes('dresser') || itemLower.includes('drawer')) {
      const drawerCount = item.name.match(/(\d+)-drawer/i)?.[1] || 'multiple';
      enhanced += `. Features ${drawerCount} drawers for ample storage space. Perfect for bedroom organization and adds a classic touch to any room.`;
      
      if (hasBrand) {
        enhanced += ` Popular IKEA model known for quality and durability.`;
      }
      
      enhanced += ` Dimensions suitable for most bedrooms. All drawers slide smoothly. Well-maintained with no structural damage. Clean and ready for immediate use.`;
      
      if (condition === 'Excellent' || condition === 'Very Good') {
        enhanced += ` Minimal signs of wear - looks nearly new.`;
      }
      
    } else if (itemLower.includes('table')) {
      enhanced += `. Sturdy construction ideal for dining or workspace.`;
      
      if (itemLower.includes('dining')) {
        enhanced += ` Seats 4-6 people comfortably. Perfect for family meals or entertaining.`;
      } else if (itemLower.includes('coffee')) {
        enhanced += ` Ideal height for living room use. Ample surface for drinks, books, and decor.`;
      }
      
      enhanced += ` Surface in good condition with normal wear consistent with age. Legs are stable with no wobbling. Great addition to any home.`;
      
    } else if (itemLower.includes('chair') || itemLower.includes('sofa')) {
      enhanced += `. Comfortable seating with good support.`;
      
      if (itemLower.includes('sofa')) {
        const seats = item.name.match(/(\d+)[\s-]?seat/i)?.[1];
        if (seats) {
          enhanced += ` ${seats}-seater perfect for living room or family room.`;
        }
        enhanced += ` Cushions retain their shape well. Frame is solid and sturdy.`;
      }
      
      enhanced += ` Upholstery/material in ${condition.toLowerCase()} condition with no major tears, stains, or damage. Non-smoking home. Perfect for living room, bedroom, or office use.`;
      
    } else if (itemLower.includes('lamp') || itemLower.includes('light')) {
      enhanced += `. Fully functional with working bulb socket and switch. Adds perfect ambient lighting to any space.`;
      
      if (itemLower.includes('floor')) {
        enhanced += ` Stable base prevents tipping. Adjustable height/angle for optimal lighting.`;
      } else if (itemLower.includes('table')) {
        enhanced += ` Compact size perfect for nightstand or side table use.`;
      }
      
      enhanced += ` Cord in excellent condition with no fraying. Shade is clean and intact. Energy-efficient bulb compatible.`;
      
    } else if (itemLower.includes('shelf') || itemLower.includes('bookcase') || itemLower.includes('bookshelf')) {
      const shelfCount = item.name.match(/(\d+)[\s-]?shelf/i)?.[1];
      enhanced += `. Excellent for storage and display.`;
      
      if (shelfCount) {
        enhanced += ` Features ${shelfCount} shelves for ample storage.`;
      } else {
        enhanced += ` Multiple shelves provide versatile storage options.`;
      }
      
      if (itemLower.includes('kallax') || itemLower.includes('expedit')) {
        enhanced += ` Popular IKEA cube storage system - perfect for books, bins, or display items.`;
      }
      
      enhanced += ` Stable construction supports heavy books without sagging. Perfect for home office, living room, or bedroom. Easy to assemble/disassemble for transport.`;
      
    } else if (itemLower.includes('desk')) {
      enhanced += `. Spacious work surface perfect for home office or study area. Sturdy construction supports computer equipment and office supplies.`;
      
      if (itemLower.includes('drawer')) {
        enhanced += ` Built-in storage keeps workspace organized.`;
      }
      
      enhanced += ` Height is comfortable for extended work sessions. Surface shows minimal wear. Cable management features help maintain clean setup.`;
      
    } else {
      // Generic but still detailed fallback
      enhanced += `. Quality item well-suited for home use. Shows normal wear consistent with age but remains fully functional.`;
      
      if (hasBrand) {
        enhanced += ` Trusted brand known for durability and style.`;
      }
      
      enhanced += ` Clean, well-maintained, and ready for immediate use. From smoke-free home.`;
    }
    
    return enhanced;
  };
  
  const [description, setDescription] = useState(generateDetailedDescription());
  
  const handleList = () => {
    onList(index, { title, price, condition, description });
  };
  
  return (
    <div className="item-edit-section">
      <div className="edit-header-row">
        <h3 className="item-edit-header">Edit Listing #{index + 1}</h3>
        {showProcessAll && (
          <button className="process-all-button" onClick={() => alert('Process all items')}>
            Process All Items
          </button>
        )}
      </div>
      
      <div className="edit-field">
        <label className="edit-label">Title</label>
        <input
          type="text"
          className="edit-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
        />
      </div>
      
      <div className="edit-field">
        <label className="edit-label">Price</label>
        <input
          type="number"
          className={`edit-input ${price > 500 ? 'price-warning' : ''}`}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          step={5}
        />
        {price > 500 && (
          <small style={{ color: '#DC2626', fontSize: 12, marginTop: 4, display: 'block' }}>
            ⚠️ High price - verify this item
          </small>
        )}
      </div>
      
      <div className="edit-field">
        <label className="edit-label">Condition</label>
        <select
          className="edit-input"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          <option value="Excellent">Excellent</option>
          <option value="Very Good">Very Good</option>
          <option value="Good">Good</option>
          <option value="Fair">Fair</option>
        </select>
      </div>
      
      <div className="edit-field">
        <label className="edit-label">Description</label>
        <textarea
          className="edit-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      
      <button className="process-button" onClick={handleList}>
        List Item
      </button>
    </div>
  );
};

const ImageAnalysis = ({ analysisData, imageFile }) => {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  
  // Process items to handle duplicate names
  const processItemsWithUniqueNames = (rawItems) => {
    const nameCounts = {};
    const processedItems = [];
    
    // First pass - count occurrences of each name
    rawItems.forEach(item => {
      const baseName = item.name;
      nameCounts[baseName] = (nameCounts[baseName] || 0) + 1;
    });
    
    // Second pass - add numbers to duplicates
    const nameIndices = {};
    rawItems.forEach(item => {
      const baseName = item.name;
      let finalName = baseName;
      
      if (nameCounts[baseName] > 1) {
        // This name appears multiple times, add a number
        nameIndices[baseName] = (nameIndices[baseName] || 0) + 1;
        finalName = `${baseName} ${nameIndices[baseName]}`;
      }
      
      processedItems.push({
        ...item,
        originalName: baseName,
        name: finalName
      });
    });
    
    return processedItems;
  };
  
  const [items, setItems] = useState(processItemsWithUniqueNames(analysisData.items || []));
  const [totalValue, setTotalValue] = useState(analysisData.totalValue || 0);
  const [imageReady, setImageReady] = useState(false);
  
  useEffect(() => {
    if (imageFile && imageRef.current) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Standardize image size for consistent processing
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          
          let width = img.width;
          let height = img.height;
          
          // Calculate scaling to fit within max dimensions while maintaining aspect ratio
          if (width > MAX_WIDTH || height > MAX_HEIGHT) {
            const widthRatio = MAX_WIDTH / width;
            const heightRatio = MAX_HEIGHT / height;
            const scale = Math.min(widthRatio, heightRatio);
            
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          
          // Create canvas to resize image
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Set the resized image
          imageRef.current.src = canvas.toDataURL('image/jpeg', 0.9);
          
          console.log(`Image standardized from ${img.width}x${img.height} to ${width}x${height}`);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(imageFile);
    }
  }, [imageFile]);
  
  useEffect(() => {
    if (imageReady && items.length > 0) {
      // Wait a bit more to ensure DOM is updated
      const timer = setTimeout(() => {
        drawBoundingBoxes();
        generateThumbnails();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [imageReady, items]);
  
  const drawBoundingBoxes = () => {
    const container = document.getElementById('imageWithBoxes');
    const img = imageRef.current;
    
    if (!container || !img) {
      console.log('Container or image not found');
      return;
    }
    
    // Check if image has real dimensions
    if (!img.complete || img.clientWidth === 0 || img.naturalWidth === 0) {
      console.log('Image not ready yet, will retry...');
      setTimeout(drawBoundingBoxes, 100);
      return;
    }
    
    // Clear existing boxes
    container.querySelectorAll('.bounding-box').forEach(box => box.remove());
    
    // Get the actual displayed dimensions
    const displayWidth = img.clientWidth;
    const displayHeight = img.clientHeight;
    
    console.log('=== BOUNDING BOX DEBUG ===');
    console.log('Image Natural Dimensions:', img.naturalWidth, 'x', img.naturalHeight);
    console.log('Image Display Dimensions:', displayWidth, 'x', displayHeight);
    console.log('Number of items:', items.length);
    
    items.forEach((item, index) => {
      if (item.boundingBox && !item.removed) {
        console.log(`\n--- Item ${index}: ${item.name} ---`);
        console.log('Raw boundingBox data:', JSON.stringify(item.boundingBox));
        console.log(`Position: ${item.boundingBox.x}% from left, ${item.boundingBox.y}% from top`);
        console.log(`Size: ${item.boundingBox.width}% wide, ${item.boundingBox.height}% tall`);
        
        // Add visual debugging - color code boxes by item type
        let boxColor = 'var(--primary-color)'; // default yellow
        const itemNameLower = item.name.toLowerCase();
        if (itemNameLower.includes('lamp')) {
          boxColor = '#FF6B6B'; // red for lamps
          console.log('🔴 LAMP DETECTED - should be on RIGHT side of image');
        } else if (itemNameLower.includes('chair')) {
          boxColor = '#4ECDC4'; // teal for chairs
        } else if (itemNameLower.includes('art') || itemNameLower.includes('print')) {
          boxColor = '#95E1D3'; // light green for art
        } else if (itemNameLower.includes('table')) {
          boxColor = '#F38181'; // pink for tables
        }
        
        const box = document.createElement('div');
        box.className = 'bounding-box';
        box.id = `box-${index}`;
        
        // Parse the bounding box values
        let x, y, width, height;
        
        // Check if we have x_min/y_min format or x/y format
        const hasMinMax = 'x_min' in item.boundingBox;
        
        if (hasMinMax) {
          // Handle x_min, y_min, x_max, y_max format
          console.log('Detected: min/max format');
          const x_min = item.boundingBox.x_min;
          const y_min = item.boundingBox.y_min;
          const x_max = item.boundingBox.x_max;
          const y_max = item.boundingBox.y_max;
          
          // Check if coordinates are normalized (0-1) or percentages
          if (x_max <= 1) {
            // Normalized coordinates
            x = x_min * displayWidth;
            y = y_min * displayHeight;
            width = (x_max - x_min) * displayWidth;
            height = (y_max - y_min) * displayHeight;
          } else if (x_max <= 100) {
            // Percentage coordinates
            x = (x_min / 100) * displayWidth;
            y = (y_min / 100) * displayHeight;
            width = ((x_max - x_min) / 100) * displayWidth;
            height = ((y_max - y_min) / 100) * displayHeight;
          } else {
            // Pixel coordinates - scale to display
            const scaleX = displayWidth / img.naturalWidth;
            const scaleY = displayHeight / img.naturalHeight;
            x = x_min * scaleX;
            y = y_min * scaleY;
            width = (x_max - x_min) * scaleX;
            height = (y_max - y_min) * scaleY;
          }
        } else {
          // Handle x, y, width, height format
          console.log('Detected: x/y/width/height format');
          
          // For Claude API, coordinates are percentages (0-100)
          // Remove the offset - let's see raw positions first
          if (item.boundingBox.x <= 100) {
            // Percentage coordinates (0-100)
            console.log('Using percentage coordinates (0-100)');
            x = (item.boundingBox.x / 100) * displayWidth;
            y = (item.boundingBox.y / 100) * displayHeight;
            width = (item.boundingBox.width / 100) * displayWidth;
            height = (item.boundingBox.height / 100) * displayHeight;
          } else {
            // Absolute pixel coordinates - scale to display size
            console.log('Using absolute pixel coordinates');
            const scaleX = displayWidth / img.naturalWidth;
            const scaleY = displayHeight / img.naturalHeight;
            x = item.boundingBox.x * scaleX;
            y = item.boundingBox.y * scaleY;
            width = item.boundingBox.width * scaleX;
            height = item.boundingBox.height * scaleY;
          }
        }
        
        console.log('Calculated position BEFORE padding:', x, y, width, height);
        
        // ADD GENEROUS PADDING for background removal (20% extra on all sides)
        const padding = 0.2; // 20% padding for background removal
        const padX = width * padding;
        const padY = height * padding;
        
        // Expand the box by padding amount
        x = x - padX;
        y = y - padY;
        width = width + (padX * 2);
        height = height + (padY * 2);
        
        console.log('Position AFTER padding:', x, y, width, height);
        
        // Ensure boxes stay within image bounds
        x = Math.max(0, x);
        y = Math.max(0, y);
        width = Math.min(width, displayWidth - x);
        height = Math.min(height, displayHeight - y);
        
        console.log('Final position:', x, y, width, height);
        
        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
        box.style.borderColor = boxColor; // Use color coding for debugging
        
        const label = document.createElement('div');
        label.className = 'box-label';
        label.textContent = `${index + 1}. ${item.name}`;
        box.appendChild(label);
        
        box.onclick = () => highlightBox(index);
        
        container.appendChild(box);
      }
    });
    console.log('=== END BOUNDING BOX DEBUG ===\n');
  };
  
  const generateThumbnails = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    const ctx = canvas?.getContext('2d');
    
    if (!canvas || !ctx || !img) {
      console.log('Canvas or image not ready for thumbnails');
      return;
    }
    
    // Check if image has real dimensions
    if (!img.complete || img.naturalWidth === 0) {
      console.log('Image not ready for thumbnails, will retry...');
      setTimeout(generateThumbnails, 100);
      return;
    }
    
    console.log('=== THUMBNAIL GENERATION DEBUG ===');
    console.log('Natural size:', img.naturalWidth, 'x', img.naturalHeight);
    console.log('Display size:', img.clientWidth, 'x', img.clientHeight);
    
    items.forEach((item, index) => {
      if (item.boundingBox && !item.removed) {
        const thumbnailImg = document.getElementById(`item-thumbnail-${index}`);
        if (!thumbnailImg) {
          console.log(`Thumbnail element ${index} not found`);
          return;
        }
        
        try {
          console.log(`\nGenerating thumbnail ${index} for ${item.name}`);
          canvas.width = 300;
          canvas.height = 200;
          
          // Parse coordinates based on their format
          let sourceX, sourceY, sourceWidth, sourceHeight;
          
          if (item.boundingBox.x <= 1 && item.boundingBox.y <= 1 && 
              item.boundingBox.width <= 1 && item.boundingBox.height <= 1) {
            // Normalized coordinates (0-1)
            sourceX = item.boundingBox.x * img.naturalWidth;
            sourceY = item.boundingBox.y * img.naturalHeight;
            sourceWidth = item.boundingBox.width * img.naturalWidth;
            sourceHeight = item.boundingBox.height * img.naturalHeight;
          } else if (item.boundingBox.x <= 100) {
            // Percentage coordinates (0-100)
            sourceX = (item.boundingBox.x / 100) * img.naturalWidth;
            sourceY = (item.boundingBox.y / 100) * img.naturalHeight;
            sourceWidth = (item.boundingBox.width / 100) * img.naturalWidth;
            sourceHeight = (item.boundingBox.height / 100) * img.naturalHeight;
          } else {
            // Absolute pixel coordinates
            sourceX = item.boundingBox.x;
            sourceY = item.boundingBox.y;
            sourceWidth = item.boundingBox.width;
            sourceHeight = item.boundingBox.height;
          }
          
          console.log('Source coords before padding:', sourceX, sourceY, sourceWidth, sourceHeight);
          
          // Apply GENEROUS padding for background removal (20% on all sides)
          const cropPadding = 0.2; // 20% padding
          const padX = sourceWidth * cropPadding;
          const padY = sourceHeight * cropPadding;
          
          sourceX = sourceX - padX;
          sourceY = sourceY - padY;
          sourceWidth = sourceWidth + (padX * 2);
          sourceHeight = sourceHeight + (padY * 2);
          
          // Ensure we don't go outside image bounds
          sourceX = Math.max(0, sourceX);
          sourceY = Math.max(0, sourceY);
          sourceWidth = Math.min(sourceWidth, img.naturalWidth - sourceX);
          sourceHeight = Math.min(sourceHeight, img.naturalHeight - sourceY);
          
          console.log('Source coords after padding:', sourceX, sourceY, sourceWidth, sourceHeight);
          
          // Clear canvas
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Calculate destination size to fit canvas while maintaining aspect ratio
          const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight) * 0.9;
          const destWidth = sourceWidth * scale;
          const destHeight = sourceHeight * scale;
          const destX = (canvas.width - destWidth) / 2;
          const destY = (canvas.height - destHeight) / 2;
          
          // Draw the cropped region
          ctx.drawImage(
            img,
            sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle
            destX, destY, destWidth, destHeight  // Destination rectangle
          );
          
          // Convert to data URL and set as thumbnail source
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          thumbnailImg.src = dataUrl;
          
        } catch (err) {
          console.error(`Failed to generate thumbnail ${index}:`, err);
          thumbnailImg.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="200"%3E%3Crect width="300" height="200" fill="%23f0f0f0"/%3E%3Ctext x="150" y="100" text-anchor="middle" fill="%23999" font-family="Arial" font-size="14"%3EThumbnail Error%3C/text%3E%3C/svg%3E';
        }
      }
    });
    console.log('=== END THUMBNAIL DEBUG ===\n');
  };
  
  const highlightBox = (index) => {
    document.querySelectorAll('.bounding-box').forEach(box => {
      box.style.borderColor = 'var(--primary-color)';
      box.style.borderWidth = '3px';
    });
    
    const box = document.getElementById(`box-${index}`);
    if (box) {
      box.style.borderColor = '#FF6B6B';
      box.style.borderWidth = '4px';
    }
    
    const itemRow = document.getElementById(`item-row-${index}`);
    itemRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  
  const removeItem = (index) => {
    const updatedItems = [...items];
    updatedItems[index].removed = true;
    setItems(updatedItems);
    
    const price = parseFloat(String(items[index].value).replace(/[^0-9.-]+/g, '')) || 0;
    setTotalValue(totalValue - price);
  };
  
  const listItem = (index, data) => {
    console.log(`Listing item ${index}:`, data);
    alert(`Item listed!\n\nTitle: ${data.title}\nPrice: $${data.price}\nCondition: ${data.condition}`);
  };
  
  const handleImageLoad = () => {
    console.log('Image loaded event fired');
    console.log('Natural dimensions:', imageRef.current?.naturalWidth, 'x', imageRef.current?.naturalHeight);
    console.log('Display dimensions:', imageRef.current?.clientWidth, 'x', imageRef.current?.clientHeight);
    
    // Set image ready after a small delay to ensure browser has rendered
    setTimeout(() => {
      setImageReady(true);
    }, 100);
  };
  
  return (
    <div className="inventory-results">
      <div className="total-value">
        <h3>Total Estimated Value</h3>
        <div className="amount">
          ${totalValue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      </div>
      
      <h3 style={{ marginBottom: 16, textAlign: 'center' }}>🏠 Prepare Listings</h3>
      
      <div className="image-with-boxes" id="imageWithBoxes" style={{ maxWidth: 800, margin: '0 auto' }}>
        <img
          ref={imageRef}
          id="analyzedImage"
          alt="Analyzed room"
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onLoad={handleImageLoad}
        />
      </div>
      
      <div className="items-container">
        {items.map((item, index) => !item.removed && (
          <div key={index} className="item-row" id={`item-row-${index}`}>
            <ItemCard
              item={item}
              index={index}
              onHighlight={highlightBox}
              onRemove={removeItem}
            />
            <ItemEditor
              item={item}
              index={index}
              onList={listItem}
              showProcessAll={index === 0}
            />
          </div>
        ))}
      </div>
      
      {analysisData.insights?.quickWins && (
        <div style={{ marginTop: 24, padding: 16, backgroundColor: '#E8F5E9', borderRadius: 8, maxWidth: 800, margin: '24px auto' }}>
          <h4 style={{ color: '#2E7D32', marginBottom: 8 }}>💡 Quick Wins:</h4>
          <ul style={{ color: '#2E7D32', marginLeft: 20, lineHeight: 1.6 }}>
            {analysisData.insights.quickWins.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
      
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

// Main App Component
export default function App() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
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
          const endpoint = API_URL + (API_URL.endsWith('/api') ? '/analyze' : '/api/analyze');
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64,
              apiKey: apiKey,
              roomType: 'unknown'
            })
          });
          
          const data = await response.json();
          
          if (data.success) {
            setAnalysisData({ ...data, imageFile });
            setMessages(prev => [...prev, { 
              role: 'assistant', 
              component: <ImageAnalysis analysisData={data} imageFile={imageFile} />
            }]);
          } else {
            setMessages(prev => [...prev, { 
              role: 'assistant', 
              text: `Error: ${data.error || 'Analysis failed'}` 
            }]);
          }
        } catch (error) {
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            text: `Error: ${error.message}` 
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
            
            {isLoading && (
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
              placeholder="Upload a room photo or type a message..."
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
      <SpeedInsights />
    </div>
  );
}