const express = require('express');
const { searchWeaviate } = require('../utils/weaviateClient');

const router = express.Router();

router.post('/search', async (req, res) => {
  try {
    const { query, limit } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }
    const results = await searchWeaviate(query, { limit: limit || 5 });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
