module.exports = async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
  
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
  
    // Test response
    res.status(200).json({
      success: true,
      message: 'API is working!',
      hasClaudeKey: !!process.env.ClaudeKey,
      envVars: Object.keys(process.env).filter(key => key.includes('Claude') || key.includes('CLAUDE')),
      method: req.method,
      timestamp: new Date().toISOString()
    });
  };