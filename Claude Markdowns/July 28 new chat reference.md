Pyckit Development - Current State & Path Forward
Project Overview
Pyckit is a marketplace listing assistant that transforms room photos into individual product listings with:
	•	AI-powered object detection
	•	Professional background removal/isolation
	•	Market-based pricing for Calgary
	•	Auto-generated titles and descriptions
Current State (July 28, 2025)
✅ What's Working
	1.	Frontend Infrastructure
	•	React app deployed on Vercel
	•	Image upload and processing UI
	•	Item cards with edit/list functionality
	•	Claude API key management
	2.	Backend API
	•	Gemini AI successfully identifies 5-6 items per image
	•	Provides bounding boxes, names, prices, descriptions
	•	~4 second response time for object detection
	3.	Basic Image Processing
	•	Simple cropping based on bounding boxes
	•	White background application
	•	Square canvas output for consistency
❌ What's Not Working
	1.	SAM Integration Issues
	•	SAM-2 API returns empty objects {} instead of mask data
	•	70+ second processing time per image
	•	418+ API calls burned through $5 Replicate credits with no results
	•	Automatic mask generation not functioning as expected
	2.	Object Isolation
	•	Currently only cropping images, not removing backgrounds
	•	All items show the same cropped section of the original image
	•	No professional product photography quality yet
🔍 Current Problem

json
// SAM API returns this:
{
  "combined_mask": {},
  "individual_masks": [{}, {}, {}, ..., {}] // 21 empty objects
}

// Instead of expected:
{
  "individual_masks": [
    "https://replicate.delivery/.../mask1.png",
    "https://replicate.delivery/.../mask2.png"
  ]
}
Path Forward
Option 1: Fix SAM Integration (Current Attempt)
	1.	Identify correct SAM parameters
	•	Test with point-based segmentation instead of automatic
	•	Use Gemini's bounding boxes to guide SAM
	•	Debug the exact response format SAM expects
	2.	Handle different mask formats
	•	ReadableStreams
	•	URLs
	•	Base64 data
	•	Binary data
Option 2: Alternative Background Removal
	1.	Remove.bg API (50 free/month)
	•	More reliable for product images
	•	Direct integration available
	2.	Client-side JS libraries
	•	@imgly/background-removal
	•	No API costs
	•	Runs in browser
	3.	Other APIs
	•	Photoroom
	•	Clipdrop by Stability AI
Option 3: Hybrid Approach
	1.	Use Gemini for detection
	2.	Crop images tightly
	3.	Apply artistic filters/shadows to simulate isolation
	4.	Enhance with client-side processing
Key Code Files
Frontend
	•	App.js - Main React app with image processing logic
	•	App.css - Styling
	•	processItemsLocally() - Handles image cropping/masking
	•	applyAutomaticSegmentationMask() - Attempts to apply SAM masks
Backend
	•	analyze-simple.js - Vercel serverless function
	•	Gemini AI integration
	•	SAM integration (broken)
	•	Image processing pipeline
Next Immediate Steps
	1.	Debug SAM Response Format javascript // Add test endpoint to see working SAM output
	2.	// Understand exact structure of successful mask   
	3.	Test Alternative SAM Approach javascript // Use point-based instead of automatic
	4.	// One mask per Gemini bounding box   
	5.	Implement Fallback javascript // If SAM fails after X attempts
	6.	// Use remove.bg or client-side solution   
Success Metrics
		 Each object properly isolated on white background
		 Individual product images match e-commerce quality
		 Processing time under 30 seconds total
		 API costs under $0.10 per image
Technical Debt
	•	SAM model version hardcoded (should fetch latest)
	•	No caching of processed images
	•	No error recovery for partial failures
	•	Frontend expects specific mask format
Environment Variables Needed

GEMINI_API_KEY=your_key
REPLICATE_API_TOKEN=your_key
REMOVEBG_API_KEY=your_key (optional fallback)
Current Blockers
	1.	SAM returning empty objects
	2.	Unknown correct parameters for automatic mask generation
	3.	Potential version mismatch with SAM model
	4.	No fallback when SAM fails
This is where we are. The goal remains: Turn a messy room photo into clean, individual product listings ready for marketplace.
