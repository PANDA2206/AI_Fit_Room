const fs = require('fs');
const path = require('path');
const https = require('https');

const CLOTHES_DIR = path.join(__dirname, '../../clothes');
const API_URL = 'http://localhost:5001';

// VITON-HD sample images (from the public test set)
// These are actual try-on ready cloth images with transparent/clean backgrounds
const VITON_SAMPLES = [
  {
    name: 'VITON Black T-Shirt',
    // Using GitHub raw content from VITON-HD repo examples
    url: 'https://raw.githubusercontent.com/shadow2496/VITON-HD/main/example/cloth/00006_00.jpg',
    category: 'top',
    subcategory: 'tshirt',
    color: '#1C1C1C',
    brand: 'VITON-HD',
    tags: ['casual', 'basic', 'black']
  },
  {
    name: 'VITON Striped Shirt',
    url: 'https://raw.githubusercontent.com/shadow2496/VITON-HD/main/example/cloth/00017_00.jpg',
    category: 'top',
    subcategory: 'shirt',
    color: '#FFFFFF',
    brand: 'VITON-HD',
    tags: ['casual', 'striped', 'summer']
  },
  {
    name: 'VITON Print Top',
    url: 'https://raw.githubusercontent.com/shadow2496/VITON-HD/main/example/cloth/00055_00.jpg',
    category: 'top',
    subcategory: 'tshirt',
    color: '#F5F5F5',
    brand: 'VITON-HD',
    tags: ['casual', 'print', 'graphic']
  }
];

// DeepFashion-style product images from open sources
const PRODUCT_IMAGES = [
  {
    name: 'Classic White Oxford',
    url: 'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'shirt',
    color: '#FFFFFF',
    brand: 'Classic',
    tags: ['formal', 'office', 'cotton', 'oxford']
  },
  {
    name: 'Navy Blue Polo',
    url: 'https://images.unsplash.com/photo-1625910513413-5fc45f51b70a?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'polo',
    color: '#1E3A5F',
    brand: 'Classic',
    tags: ['smart-casual', 'summer', 'cotton']
  },
  {
    name: 'Gray Crewneck Sweatshirt',
    url: 'https://images.unsplash.com/photo-1578681994506-b8f463449011?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'sweatshirt',
    color: '#808080',
    brand: 'Comfort',
    tags: ['casual', 'comfortable', 'cotton']
  },
  {
    name: 'Black Leather Jacket',
    url: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'jacket',
    color: '#1C1C1C',
    brand: 'Urban',
    tags: ['casual', 'leather', 'cool']
  },
  {
    name: 'Denim Jacket Classic',
    url: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'jacket',
    color: '#5DADE2',
    brand: 'Denim Co',
    tags: ['casual', 'denim', 'classic']
  },
  {
    name: 'Burgundy Sweater',
    url: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'sweater',
    color: '#722F37',
    brand: 'Cozy',
    tags: ['winter', 'warm', 'knit']
  },
  {
    name: 'Striped T-Shirt',
    url: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'tshirt',
    color: '#FFFFFF',
    brand: 'Basics',
    tags: ['casual', 'striped', 'cotton']
  },
  {
    name: 'Green Flannel Shirt',
    url: 'https://images.unsplash.com/photo-1608234808654-2a8875faa7fd?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'shirt',
    color: '#228B22',
    brand: 'Outdoor',
    tags: ['casual', 'flannel', 'plaid']
  },
  {
    name: 'Black Hoodie Essential',
    url: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'hoodie',
    color: '#1C1C1C',
    brand: 'Street',
    tags: ['casual', 'streetwear', 'comfortable']
  },
  {
    name: 'Cream Cardigan',
    url: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'cardigan',
    color: '#F5F5DC',
    brand: 'Cozy',
    tags: ['layering', 'knit', 'comfortable']
  },
  {
    name: 'Light Blue Dress Shirt',
    url: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'shirt',
    color: '#ADD8E6',
    brand: 'Business',
    tags: ['formal', 'office', 'professional']
  },
  {
    name: 'Olive Bomber Jacket',
    url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'jacket',
    color: '#556B2F',
    brand: 'Military',
    tags: ['casual', 'bomber', 'military']
  }
];

function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filepath = path.join(CLOTHES_DIR, filename);
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadImage(response.headers.location, filename)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function downloadProductImages() {
  console.log('=== Downloading Real Product Images ===\n');
  
  if (!fs.existsSync(CLOTHES_DIR)) {
    fs.mkdirSync(CLOTHES_DIR, { recursive: true });
  }
  
  const allItems = [...PRODUCT_IMAGES];
  const results = [];
  
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const filename = `product-${i + 1}.jpg`;
    
    try {
      await downloadImage(item.url, filename);
      console.log(`✓ [${i + 1}/${allItems.length}] ${item.name}`);
      
      results.push({
        ...item,
        image: `/clothes/${filename}`,
        thumbnail: `/clothes/${filename}`,
        source: 'product-images'
      });
    } catch (error) {
      console.log(`✗ [${i + 1}/${allItems.length}] ${item.name} - ${error.message}`);
    }
  }
  
  // Save metadata
  const metadataPath = path.join(CLOTHES_DIR, 'products.json');
  fs.writeFileSync(metadataPath, JSON.stringify(results, null, 2));
  
  console.log(`\n✓ Downloaded ${results.length} product images`);
  console.log(`✓ Metadata saved to: ${metadataPath}`);
  
  return results;
}

async function importToAPI(clothes) {
  console.log('\n=== Importing to API ===\n');
  
  try {
    const response = await fetch(`${API_URL}/api/clothes/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clothes })
    });
    
    const result = await response.json();
    console.log(`✓ Imported ${result.imported?.length || 0} items to database`);
    return result;
  } catch (error) {
    console.log(`Note: API import skipped (server not running or fetch unavailable)`);
    console.log('The images are downloaded. Restart the app to load them.');
    return null;
  }
}

async function main() {
  const products = await downloadProductImages();
  
  // Try to import to API
  if (products.length > 0) {
    await importToAPI(products);
  }
  
  console.log('\n=== Done! ===');
  console.log('\nTo use these images:');
  console.log('1. Images are in: /clothes/*.jpg');
  console.log('2. Restart the Docker containers: docker-compose restart');
  console.log('3. Open http://localhost:3000 and try them on!');
}

module.exports = { downloadProductImages, PRODUCT_IMAGES };

if (require.main === module) {
  main().catch(console.error);
}
