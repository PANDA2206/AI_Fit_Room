const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Sample clothing images from open sources (placeholder URLs)
// In production, use actual VITON-HD or DeepFashion dataset images
const SAMPLE_CLOTHES = [
  {
    name: 'casual-tshirt-blue',
    url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'tshirt',
    color: '#3498DB',
    tags: ['casual', 'summer', 'cotton']
  },
  {
    name: 'formal-shirt-white',
    url: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'shirt',
    color: '#FFFFFF',
    tags: ['formal', 'office', 'cotton']
  },
  {
    name: 'hoodie-gray',
    url: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'hoodie',
    color: '#7F8C8D',
    tags: ['casual', 'winter', 'comfortable']
  },
  {
    name: 'sweater-cream',
    url: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'sweater',
    color: '#F5F5DC',
    tags: ['casual', 'winter', 'cozy']
  },
  {
    name: 'jacket-denim',
    url: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'jacket',
    color: '#5DADE2',
    tags: ['casual', 'denim', 'layering']
  },
  {
    name: 'polo-navy',
    url: 'https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'polo',
    color: '#2C3E50',
    tags: ['smart-casual', 'summer', 'classic']
  },
  {
    name: 'blazer-black',
    url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'blazer',
    color: '#1C1C1C',
    tags: ['formal', 'office', 'elegant']
  },
  {
    name: 'cardigan-beige',
    url: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&h=500&fit=crop',
    category: 'top',
    subcategory: 'cardigan',
    color: '#D7CCC8',
    tags: ['casual', 'layering', 'cozy']
  }
];

const CLOTHES_DIR = path.join(__dirname, '../../clothes');

// Ensure directory exists
if (!fs.existsSync(CLOTHES_DIR)) {
  fs.mkdirSync(CLOTHES_DIR, { recursive: true });
}

function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filepath = path.join(CLOTHES_DIR, filename);
    const file = fs.createWriteStream(filepath);
    
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadImage(response.headers.location, filename)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded: ${filename}`);
        resolve(filepath);
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {}); // Delete failed file
      reject(err);
    });
  });
}

async function downloadAllImages() {
  console.log('Downloading sample clothing images...\n');
  console.log(`Target directory: ${CLOTHES_DIR}\n`);
  
  const results = [];
  
  for (const item of SAMPLE_CLOTHES) {
    const filename = `${item.name}.jpg`;
    try {
      await downloadImage(item.url, filename);
      results.push({
        ...item,
        image: `/clothes/${filename}`,
        thumbnail: `/clothes/${filename}`,
        downloaded: true
      });
    } catch (error) {
      console.log(`✗ Failed: ${item.name} - ${error.message}`);
      results.push({
        ...item,
        downloaded: false,
        error: error.message
      });
    }
  }
  
  // Save metadata
  const metadataPath = path.join(CLOTHES_DIR, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Metadata saved to: ${metadataPath}`);
  
  const successful = results.filter(r => r.downloaded).length;
  console.log(`\nDownloaded ${successful}/${SAMPLE_CLOTHES.length} images`);
  
  return results;
}

// Export for use as module
module.exports = { downloadAllImages, SAMPLE_CLOTHES };

// Run directly
if (require.main === module) {
  downloadAllImages()
    .then(() => console.log('\nDone!'))
    .catch(console.error);
}
