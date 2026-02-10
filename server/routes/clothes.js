const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// In-memory store (use database in production)
let clothesDB = [];
let nextId = 1;

// Load products from downloaded images
const loadProductImages = () => {
  const productsPath = path.join(__dirname, '../../clothes/products.json');
  try {
    if (fsSync.existsSync(productsPath)) {
      const data = fsSync.readFileSync(productsPath, 'utf-8');
      const products = JSON.parse(data);
      return products.map(p => ({
        id: nextId++,
        name: p.name,
        category: p.category || 'top',
        subcategory: p.subcategory || 'other',
        brand: p.brand || 'Unknown',
        image: p.image,
        thumbnail: p.thumbnail || p.image,
        color: p.color || '#CCCCCC',
        price: p.price || null,
        source: 'product-images',
        tags: p.tags || []
      }));
    }
  } catch (err) {
    console.log('No product images found, using defaults');
  }
  return [];
};

// Initialize with sample data + downloaded products
const initializeSampleData = async () => {
  // First load any downloaded product images
  const productImages = loadProductImages();
  
  // Add SVG fallbacks
  const svgClothes = [
    {
      id: nextId++,
      name: 'Blue T-Shirt',
      category: 'top',
      subcategory: 'tshirt',
      brand: 'Sample',
      image: '/clothes/blue-tshirt.svg',
      thumbnail: '/clothes/blue-tshirt.svg',
      color: '#4A90D9',
      price: null,
      source: 'local',
      tags: ['casual', 'summer', 'cotton']
    },
    {
      id: nextId++,
      name: 'Red Hoodie',
      category: 'top',
      subcategory: 'hoodie',
      brand: 'Sample',
      image: '/clothes/red-hoodie.svg',
      thumbnail: '/clothes/red-hoodie.svg',
      color: '#E74C3C',
      price: null,
      source: 'local',
      tags: ['casual', 'winter', 'comfortable']
    },
    {
      name: 'White Shirt',
      category: 'top',
      subcategory: 'shirt',
      brand: 'Sample',
      image: '/clothes/white-shirt.svg',
      thumbnail: '/clothes/white-shirt.svg',
      color: '#FFFFFF',
      price: null,
      source: 'local',
      tags: ['formal', 'office', 'cotton']
    },
    {
      id: nextId++,
      name: 'Green Jacket',
      category: 'top',
      subcategory: 'jacket',
      brand: 'Sample',
      image: '/clothes/green-jacket.svg',
      thumbnail: '/clothes/green-jacket.svg',
      color: '#27AE60',
      price: null,
      source: 'local',
      tags: ['outdoor', 'winter', 'layering']
    },
    {
      id: nextId++,
      name: 'Purple Sweater',
      category: 'top',
      subcategory: 'sweater',
      brand: 'Sample',
      image: '/clothes/purple-sweater.svg',
      thumbnail: '/clothes/purple-sweater.svg',
      color: '#9B59B6',
      price: null,
      source: 'local',
      tags: ['casual', 'winter', 'cozy']
    },
    {
      id: nextId++,
      name: 'Yellow Vest',
      category: 'top',
      subcategory: 'vest',
      brand: 'Sample',
      image: '/clothes/yellow-vest.svg',
      thumbnail: '/clothes/yellow-vest.svg',
      color: '#F1C40F',
      price: null,
      source: 'local',
      tags: ['casual', 'layering', 'summer']
    }
  ];
  
  // Merge product images first (real clothes), then SVG fallbacks
  clothesDB = [...productImages, ...svgClothes];
  console.log(`Loaded ${productImages.length} product images and ${svgClothes.length} SVG samples`);
};

// Initialize on startup
initializeSampleData();

// GET all clothes with filtering
router.get('/', (req, res) => {
  let result = [...clothesDB];
  
  // Filter by category
  if (req.query.category) {
    result = result.filter(c => c.category === req.query.category);
  }
  
  // Filter by subcategory
  if (req.query.subcategory) {
    result = result.filter(c => c.subcategory === req.query.subcategory);
  }
  
  // Filter by brand
  if (req.query.brand) {
    result = result.filter(c => c.brand?.toLowerCase() === req.query.brand.toLowerCase());
  }
  
  // Filter by source
  if (req.query.source) {
    result = result.filter(c => c.source === req.query.source);
  }
  
  // Search by name
  if (req.query.search) {
    const searchLower = req.query.search.toLowerCase();
    result = result.filter(c => 
      c.name.toLowerCase().includes(searchLower) ||
      c.tags?.some(t => t.toLowerCase().includes(searchLower))
    );
  }
  
  // Pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  
  const paginatedResult = {
    data: result.slice(startIndex, endIndex),
    pagination: {
      total: result.length,
      page,
      limit,
      pages: Math.ceil(result.length / limit)
    }
  };
  
  res.json(paginatedResult);
});

// GET single cloth by ID
router.get('/:id', (req, res) => {
  const cloth = clothesDB.find(c => c.id === parseInt(req.params.id));
  if (!cloth) {
    return res.status(404).json({ error: 'Cloth not found' });
  }
  res.json(cloth);
});

// POST add new cloth
router.post('/', async (req, res) => {
  const { name, category, subcategory, brand, image, thumbnail, color, price, source, tags } = req.body;
  
  if (!name || !image) {
    return res.status(400).json({ error: 'Name and image are required' });
  }
  
  const newCloth = {
    id: nextId++,
    name,
    category: category || 'top',
    subcategory: subcategory || 'other',
    brand: brand || 'Unknown',
    image,
    thumbnail: thumbnail || image,
    color: color || '#CCCCCC',
    price: price || null,
    source: source || 'api',
    tags: tags || [],
    createdAt: new Date().toISOString()
  };
  
  clothesDB.push(newCloth);
  res.status(201).json(newCloth);
});

// POST bulk import clothes
router.post('/bulk', async (req, res) => {
  const { clothes } = req.body;
  
  if (!Array.isArray(clothes)) {
    return res.status(400).json({ error: 'clothes must be an array' });
  }
  
  const imported = [];
  for (const item of clothes) {
    if (item.name && item.image) {
      const newCloth = {
        id: nextId++,
        name: item.name,
        category: item.category || 'top',
        subcategory: item.subcategory || 'other',
        brand: item.brand || 'Unknown',
        image: item.image,
        thumbnail: item.thumbnail || item.image,
        color: item.color || '#CCCCCC',
        price: item.price || null,
        source: item.source || 'bulk-import',
        tags: item.tags || [],
        createdAt: new Date().toISOString()
      };
      clothesDB.push(newCloth);
      imported.push(newCloth);
    }
  }
  
  res.status(201).json({ 
    message: `Imported ${imported.length} clothes`,
    imported 
  });
});

// PUT update cloth
router.put('/:id', (req, res) => {
  const index = clothesDB.findIndex(c => c.id === parseInt(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Cloth not found' });
  }
  
  clothesDB[index] = {
    ...clothesDB[index],
    ...req.body,
    id: clothesDB[index].id, // Prevent ID change
    updatedAt: new Date().toISOString()
  };
  
  res.json(clothesDB[index]);
});

// DELETE cloth
router.delete('/:id', (req, res) => {
  const index = clothesDB.findIndex(c => c.id === parseInt(req.params.id));
  if (index === -1) {
    return res.status(404).json({ error: 'Cloth not found' });
  }
  
  clothesDB.splice(index, 1);
  res.json({ message: 'Cloth deleted successfully' });
});

// GET categories
router.get('/meta/categories', (req, res) => {
  const categories = [...new Set(clothesDB.map(c => c.category))];
  const subcategories = [...new Set(clothesDB.map(c => c.subcategory))];
  const brands = [...new Set(clothesDB.map(c => c.brand).filter(Boolean))];
  
  res.json({ categories, subcategories, brands });
});

// POST import from external API (template for brand integrations)
router.post('/import/external', async (req, res) => {
  const { provider, apiKey, endpoint, mapping } = req.body;
  
  // This is a template - implement actual API calls based on provider
  // Example providers: asos, shopify, custom
  
  try {
    // Placeholder for external API integration
    res.json({ 
      message: 'External import endpoint ready',
      supportedProviders: ['asos', 'shopify', 'custom', 'viton-dataset'],
      instructions: {
        asos: 'Requires affiliate partnership',
        shopify: 'Provide store URL and API key',
        custom: 'Provide endpoint and field mapping',
        'viton-dataset': 'Downloads from VITON-HD dataset'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
