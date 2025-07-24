const { Anthropic } = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const apiKey = process.env.ClaudeKey;
    
    if (!apiKey) {
      return res.status(500).json({ 
        success: false, 
        error: 'ClaudeKey not found in environment' 
      });
    }
    
    // Try to initialize Anthropic
    const anthropic = new Anthropic({ apiKey });
    
    // Try a simple API call
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: "Say 'API is working!' in exactly 3 words."
      }]
    });
    
    res.status(200).json({
      success: true,
      message: 'Anthropic connection successful!',
      claudeResponse: message.content[0].text,
      apiKeyLength: apiKey.length,
      apiKeyPrefix: apiKey.substring(0, 10) + '...'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: error.constructor.name,
      stack: error.stack
    });
  }
};