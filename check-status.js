const { processingQueue } = require('./queue-system');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { queueId } = req.query;
    
    if (!queueId) {
      return res.status(400).json({ error: 'Queue ID required' });
    }
    
    const status = processingQueue.getJobStatus(queueId);
    
    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.status(200).json({
      success: true,
      ...status
    });
    
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};