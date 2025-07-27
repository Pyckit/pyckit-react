const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');
const crypto = require('crypto');

// Simple in-memory database (replace with Redis/MongoDB in production)
const jobsDB = new Map();
const processedItemsDB = new Map();
const cacheDB = new Map();

// Token rotation system
class TokenRotation {
  constructor() {
    // Add multiple tokens if available
    this.tokens = [
      process.env.REPLICATE_API_TOKEN,
      process.env.REPLICATE_API_TOKEN_2,
      process.env.REPLICATE_API_TOKEN_3,
    ].filter(Boolean); // Remove undefined tokens
    
    this.currentIndex = 0;
    this.tokenUsage = new Map();
    this.tokenLastUsed = new Map();
  }
  
  getNextToken() {
    if (this.tokens.length === 0) return null;
    if (this.tokens.length === 1) return this.tokens[0];
    
    // Simple round-robin with cooldown check
    const now = Date.now();
    let attempts = 0;
    
    while (attempts < this.tokens.length) {
      const token = this.tokens[this.currentIndex];
      const lastUsed = this.tokenLastUsed.get(token) || 0;
      
      // 15 second cooldown per token
      if (now - lastUsed > 15000) {
        this.tokenLastUsed.set(token, now);
        this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
        return token;
      }
      
      this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
      attempts++;
    }
    
    // All tokens on cooldown, use the oldest one
    return this.tokens[0];
  }
}

// Segmentation cache system
class SegmentationCache {
  generateHash(item, imageHash) {
    // Create a hash based on item properties and image
    const itemString = `${item.category}_${item.name}_${Math.round(item.boundingBox.x)}_${Math.round(item.boundingBox.y)}`;
    return crypto.createHash('md5').update(itemString + imageHash).digest('hex');
  }
  
  async get(hash) {
    return cacheDB.get(hash);
  }
  
  async set(hash, data) {
    cacheDB.set(hash, {
      ...data,
      timestamp: Date.now()
    });
    
    // Simple cache cleanup - keep last 1000 items
    if (cacheDB.size > 1000) {
      const entries = Array.from(cacheDB.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      cacheDB.delete(entries[0][0]);
    }
  }
}

// Priority queue for job processing
class PriorityQueue {
  constructor() {
    this.queue = [];
  }
  
  add(job) {
    const priority = this.calculatePriority(job);
    job.priority = priority;
    
    // Insert in priority order
    const index = this.queue.findIndex(j => j.priority < priority);
    if (index === -1) {
      this.queue.push(job);
    } else {
      this.queue.splice(index, 0, job);
    }
  }
  
  calculatePriority(job) {
    let score = 0;
    
    // User tier (for future monetization)
    if (job.userTier === 'premium') score += 10000;
    if (job.userTier === 'hobby') score += 5000;
    
    // Item value influences priority
    score += Math.min(job.totalValue || 0, 1000);
    
    // Wait time to prevent starvation (1 point per second)
    const waitTime = Date.now() - job.createdAt;
    score += waitTime / 1000;
    
    // Fewer items = higher priority (faster to process)
    score += (10 - job.items.length) * 100;
    
    return score;
  }
  
  shift() {
    return this.queue.shift();
  }
  
  get length() {
    return this.queue.length;
  }
}

// Main processing queue
class SAMProcessingQueue {
  constructor() {
    this.queue = new PriorityQueue();
    this.processing = false;
    this.tokenRotation = new TokenRotation();
    this.cache = new SegmentationCache();
    this.rateLimitDelay = 15000; // Start with 15s
    this.consecutiveErrors = 0;
  }
  
  async addJob(userId, items, imageData, userTier = 'free') {
    const job = {
      id: crypto.randomUUID(),
      userId,
      items,
      imageData,
      userTier,
      status: 'queued',
      createdAt: Date.now(),
      completedItems: 0,
      totalItems: items.length,
      totalValue: items.reduce((sum, item) => sum + (item.value || 0), 0)
    };
    
    // Store job
    jobsDB.set(job.id, job);
    
    // Add to queue
    this.queue.add(job);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }
    
    return job.id;
  }
  
  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    
    console.log('🚀 Starting queue processing...');
    
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      
      try {
        console.log(`Processing job ${job.id} with ${job.items.length} items`);
        
        // Update job status
        job.status = 'processing';
        jobsDB.set(job.id, job);
        
        // Process each item
        for (let i = 0; i < job.items.length; i++) {
          const item = job.items[i];
          
          try {
            // Check cache first
            const imageHash = crypto.createHash('md5')
              .update(job.imageData.substring(0, 1000))
              .digest('hex');
            const cacheKey = this.cache.generateHash(item, imageHash);
            const cached = await this.cache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < 86400000) { // 24 hour cache
              console.log(`✅ Using cached mask for ${item.name}`);
              
              // Store result
              await this.storeProcessedItem(job.id, item, cached.mask, cached.cropCoords);
              job.completedItems++;
              continue;
            }
            
            // Get next available token
            const token = this.tokenRotation.getNextToken();
            if (!token) {
              throw new Error('No Replicate tokens available');
            }
            
            // Process with SAM
            console.log(`🎯 Processing ${item.name} with SAM...`);
            const result = await this.processSingleItem(item, job.imageData, token);
            
            // Cache the result
            await this.cache.set(cacheKey, result);
            
            // Store result
            await this.storeProcessedItem(job.id, item, result.mask, result.cropCoords);
            
            job.completedItems++;
            this.consecutiveErrors = 0; // Reset error counter
            
            // Dynamic delay based on success
            if (this.rateLimitDelay > 10000) {
              this.rateLimitDelay = Math.max(10000, this.rateLimitDelay - 1000);
            }
            
          } catch (error) {
            console.error(`Error processing ${item.name}:`, error.message);
            
            if (error.message.includes('429')) {
              // Rate limit hit - increase delay
              this.consecutiveErrors++;
              this.rateLimitDelay = Math.min(60000, this.rateLimitDelay * 2);
              console.log(`Rate limited. Increasing delay to ${this.rateLimitDelay/1000}s`);
              
              // Put item back for retry
              job.items.push(item);
            }
          }
          
          // Delay between items
          if (i < job.items.length - 1) {
            console.log(`Waiting ${this.rateLimitDelay/1000}s before next item...`);
            await this.delay(this.rateLimitDelay);
          }
        }
        
        // Job complete
        job.status = 'completed';
        job.completedAt = Date.now();
        jobsDB.set(job.id, job);
        
        console.log(`✅ Job ${job.id} completed!`);
        
      } catch (error) {
        console.error(`Job ${job.id} failed:`, error);
        job.status = 'failed';
        job.error = error.message;
        jobsDB.set(job.id, job);
      }
      
      // Small delay between jobs
      if (this.queue.length > 0) {
        await this.delay(5000);
      }
    }
    
    this.processing = false;
    console.log('Queue processing stopped - no more jobs');
  }
  
  async processSingleItem(item, imageBase64, token) {
    const replicate = new Replicate({ auth: token });
    
    // Get image dimensions
    const dimensions = this.getImageDimensions(imageBase64);
    
    // Calculate bounding box
    const { x, y, width, height } = item.boundingBox;
    const padding = 1.2;
    const imgW = dimensions.width;
    const imgH = dimensions.height;
    
    const boxW = (width / 100 * imgW) * padding;
    const boxH = (height / 100 * imgH) * padding;
    const x1 = Math.max(0, Math.round((x / 100 * imgW) - boxW / 2));
    const y1 = Math.max(0, Math.round((y / 100 * imgH) - boxH / 2));
    const x2 = Math.min(imgW, Math.round((x / 100 * imgW) + boxW / 2));
    const y2 = Math.min(imgH, Math.round((y / 100 * imgH) + boxH / 2));
    
    // Call SAM
    const output = await replicate.run(
      "meta/sam-2-large",
      {
        input: {
          image: `data:image/jpeg;base64,${imageBase64}`,
          box: `${x1} ${y1} ${x2} ${y2}`,
          model_size: "large",
          multimask_output: false
        }
      }
    );
    
    if (!output || !output[0]) {
      throw new Error('SAM returned no mask');
    }
    
    return {
      mask: output[0],
      cropCoords: { x1, y1, x2, y2 }
    };
  }
  
  async storeProcessedItem(jobId, item, mask, cropCoords) {
    const processedItem = {
      id: crypto.randomUUID(),
      jobId,
      itemId: item.id || item.name,
      name: item.name,
      mask,
      cropCoords,
      processedAt: Date.now()
    };
    
    processedItemsDB.set(processedItem.id, processedItem);
    
    // In production, emit WebSocket event here
    // io.emit(`job-${jobId}-progress`, processedItem);
  }
  
  getImageDimensions(base64) {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      let block_length = buffer[offset] * 256 + buffer[offset + 1];
      while (offset < buffer.length) {
        offset += block_length;
        if (offset >= buffer.length) break;
        if (buffer[offset] !== 0xFF) break;
        if (buffer[offset + 1] === 0xC0 || buffer[offset + 1] === 0xC2) {
          const height = buffer[offset + 5] * 256 + buffer[offset + 6];
          const width = buffer[offset + 7] * 256 + buffer[offset + 8];
          return { width, height };
        }
        offset += 2;
        block_length = buffer[offset] * 256 + buffer[offset + 1];
      }
    }
    return { width: 1024, height: 1024 };
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // API methods for checking status
  getJobStatus(jobId) {
    const job = jobsDB.get(jobId);
    if (!job) return null;
    
    const processedItems = Array.from(processedItemsDB.values())
      .filter(item => item.jobId === jobId);
    
    return {
      id: job.id,
      status: job.status,
      completedItems: job.completedItems,
      totalItems: job.totalItems,
      processedItems,
      createdAt: job.createdAt,
      completedAt: job.completedAt
    };
  }
}

// Create singleton instance
const processingQueue = new SAMProcessingQueue();

module.exports = { processingQueue };