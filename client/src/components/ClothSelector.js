import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { emitClothSelected } from '../services/socket';
import './ClothSelector.css';

const DEFAULT_API_URL = process.env.NODE_ENV === 'production'
  ? 'https://ai-fit-room.onrender.com'
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');

const API_URL = process.env.REACT_APP_API_URL || DEFAULT_API_URL;
const LOCAL_SVG_SOURCE = 'local-svgs';
const CATALOG_SOURCE = 'catalog';
const DRESSCODE_SOURCE = 'dresscode-rembg';

const normalizeInitialSource = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return CATALOG_SOURCE;

  if (raw === LOCAL_SVG_SOURCE) return DRESSCODE_SOURCE;
  if (raw === 'fashion-product-images-kaggle') return CATALOG_SOURCE;
  if (raw === 'dresscode') return DRESSCODE_SOURCE;

  if (raw === CATALOG_SOURCE || raw === DRESSCODE_SOURCE) return raw;
  return CATALOG_SOURCE;
};

const PRODUCT_SOURCE = normalizeInitialSource(process.env.REACT_APP_PRODUCT_SOURCE);
const SOURCE_OPTIONS = [
  { id: CATALOG_SOURCE, label: 'Catalog' },
  { id: DRESSCODE_SOURCE, label: 'Dresscode' }
];
const DRESSCODE_DEMO_CLOTHES = [
  {
    id: 'blue-tshirt',
    name: 'Blue Tee',
    image: '/clothes/blue-tshirt.svg',
    thumbnail: '/clothes/blue-tshirt.svg',
    category: 'top',
    subcategory: 'tshirt',
    articleType: 'tshirt',
    color: '#4a9efd',
    brand: 'Sample',
    price: 0,
    source: LOCAL_SVG_SOURCE
  },
  {
    id: 'green-jacket',
    name: 'Green Jacket',
    image: '/clothes/green-jacket.svg',
    thumbnail: '/clothes/green-jacket.svg',
    category: 'top',
    subcategory: 'jacket',
    articleType: 'jacket',
    color: '#4caf50',
    brand: 'Sample',
    price: 0,
    source: LOCAL_SVG_SOURCE
  },
  {
    id: 'purple-sweater',
    name: 'Purple Sweater',
    image: '/clothes/purple-sweater.svg',
    thumbnail: '/clothes/purple-sweater.svg',
    category: 'top',
    subcategory: 'sweater',
    articleType: 'sweater',
    color: '#9c27b0',
    brand: 'Sample',
    price: 0,
    source: LOCAL_SVG_SOURCE
  },
  {
    id: 'red-hoodie',
    name: 'Red Hoodie',
    image: '/clothes/red-hoodie.svg',
    thumbnail: '/clothes/red-hoodie.svg',
    category: 'top',
    subcategory: 'hoodie',
    articleType: 'hoodie',
    color: '#e53935',
    brand: 'Sample',
    price: 0,
    source: LOCAL_SVG_SOURCE
  },
  {
    id: 'white-shirt',
    name: 'White Shirt',
    image: '/clothes/white-shirt.svg',
    thumbnail: '/clothes/white-shirt.svg',
    category: 'top',
    subcategory: 'shirt',
    articleType: 'shirt',
    color: '#f5f5f5',
    brand: 'Sample',
    price: 0,
    source: LOCAL_SVG_SOURCE
  },
  {
    id: 'yellow-vest',
    name: 'Yellow Vest',
    image: '/clothes/yellow-vest.svg',
    thumbnail: '/clothes/yellow-vest.svg',
    category: 'top',
    subcategory: 'vest',
    articleType: 'vest',
    color: '#ffb300',
    brand: 'Sample',
    price: 0,
    source: LOCAL_SVG_SOURCE
  }
];

const AUDIENCE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'women', label: 'Women' },
  { id: 'men', label: 'Men' },
  { id: 'unisex', label: 'Unisex' }
];

const ClothSelector = ({ onSelect, selectedCloth }) => {
  const [clothes, setClothes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoryField, setCategoryField] = useState('subcategory');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedAudience, setSelectedAudience] = useState('all');
  const [productSource, setProductSource] = useState(PRODUCT_SOURCE);
  const [searchTerm, setSearchTerm] = useState('');
  const [brokenImageIds, setBrokenImageIds] = useState(() => new Set());
  const catalogCacheRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  const humanizeText = useCallback((value) => {
    return String(value || '')
      .trim()
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }, []);

  const resolveBackendAssetUrl = useCallback((value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(data:|blob:|https?:\/\/)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return `${API_URL}${raw}`;
    return `${API_URL}/${raw}`;
  }, []);

  const loadCatalogMetadata = useCallback(async () => {
    if (Array.isArray(catalogCacheRef.current)) {
      return catalogCacheRef.current;
    }

    const response = await fetch(`${API_URL}/clothes/metadata.json`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load catalog metadata (${response.status})`);
    }
    const data = await response.json();
    catalogCacheRef.current = Array.isArray(data) ? data : [];
    return catalogCacheRef.current;
  }, []);

  const normalizeCloth = useCallback((cloth = {}) => {
    const id = String(cloth.id || cloth.publicId || cloth.dbId || cloth.sourceId || cloth.externalId || '').trim();
    const title = String(cloth.title || cloth.name || '').trim();
    const imageUrl = String(cloth.imageUrl || cloth.image_url || cloth.image || '').trim();
    const thumbnailUrl = String(cloth.thumbnailUrl || cloth.thumbnail_url || cloth.thumbnail || imageUrl).trim();
    const subcategory = cloth.subcategory || cloth.category || 'other';
    const articleType = cloth.articleType || cloth.article_type || null;

    return {
      ...cloth,
      id,
      title,
      name: title,
      image: (cloth.source || productSource) === LOCAL_SVG_SOURCE
        ? imageUrl
        : resolveBackendAssetUrl(imageUrl),
      thumbnail: (cloth.source || productSource) === LOCAL_SVG_SOURCE
        ? thumbnailUrl
        : resolveBackendAssetUrl(thumbnailUrl),
      sourceId: cloth.sourceId || cloth.source_id || cloth.externalId || cloth.external_id || null,
      source: cloth.source || productSource,
      subcategory,
      articleType
    };
  }, [productSource, resolveBackendAssetUrl]);

  const fetchClothes = useCallback(async (category = null, search = null, sourceOverride) => {
    try {
      setLoading(true);
      setLoadError('');
      const source = sourceOverride || productSource;

      if (source === CATALOG_SOURCE) {
        const catalog = await loadCatalogMetadata();
        const filteredCatalog = catalog.filter((item) => {
          const matchesCategory = !category
            || category === 'all'
            || String(item.subcategory || item.category || '').toLowerCase() === String(category).toLowerCase();
          const matchesSearch = !search
            || String(item.name || '').toLowerCase().includes(search.toLowerCase())
            || String(item.subcategory || item.category || '').toLowerCase().includes(search.toLowerCase());
          return matchesCategory && matchesSearch;
        });

        const normalizedCatalog = filteredCatalog
          .map((cloth) => normalizeCloth({
            ...cloth,
            id: cloth.id || cloth.name,
            title: cloth.title || humanizeText(cloth.name),
            source: CATALOG_SOURCE
          }))
          .filter((cloth) => cloth.id && cloth.image);

        setClothes(normalizedCatalog);
        setBrokenImageIds(new Set());
        setLoading(false);
        return;
      }

      if (source === DRESSCODE_SOURCE) {
        const filteredDemo = DRESSCODE_DEMO_CLOTHES.filter((item) => {
          const matchesCategory = !category
            || category === 'all'
            || (
              categoryField === 'articleType'
                ? String(item.articleType || '').toLowerCase() === String(category).toLowerCase()
                : String(item.subcategory || '').toLowerCase() === String(category).toLowerCase()
            );
          const matchesSearch = !search
            || item.name.toLowerCase().includes(search.toLowerCase())
            || item.subcategory.toLowerCase().includes(search.toLowerCase());
          return matchesCategory && matchesSearch;
        });

        const normalizedDemo = filteredDemo
          .map((cloth) => normalizeCloth(cloth))
          .filter((cloth) => cloth.id && cloth.image);

        let apiNormalized = [];
        try {
          let url = `${API_URL}/api/clothes?limit=200&source=${encodeURIComponent(source)}&scope=tryon`;

          if (category && category !== 'all') {
            url += `&${categoryField}=${encodeURIComponent(category)}`;
          }
          if (search) {
            url += `&search=${encodeURIComponent(search)}`;
          }

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Failed to load catalog (${response.status})`);
          }
          const result = await response.json();

          const clothesData = result.data || result;
          apiNormalized = Array.isArray(clothesData)
            ? clothesData
              .map((cloth) => normalizeCloth(cloth))
              .filter((cloth) => cloth.id && cloth.image)
            : [];
        } catch (error) {
          console.error('Error fetching dresscode catalog:', error);
          if (normalizedDemo.length === 0) {
            setLoadError('Unable to load fashion catalog right now.');
          }
        }

        const seen = new Set();
        const merged = [...normalizedDemo, ...apiNormalized].filter((item) => {
          if (!item.id) return false;
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });

        setClothes(merged);
        setBrokenImageIds(new Set());
        setLoading(false);
        return;
      }

      let url = `${API_URL}/api/clothes?limit=200&source=${encodeURIComponent(source)}&scope=tryon`;

      if (category && category !== 'all') {
        url += `&${categoryField}=${encodeURIComponent(category)}`;
      }
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load catalog (${response.status})`);
      }
      const result = await response.json();

      const clothesData = result.data || result;
      const normalized = Array.isArray(clothesData)
        ? clothesData
          .map((cloth) => normalizeCloth(cloth))
          .filter((cloth) => cloth.id && cloth.image)
        : [];

      setClothes(normalized);
      setBrokenImageIds(new Set());
      setLoading(false);
    } catch (error) {
      console.error('Error fetching clothes:', error);
      setLoadError('Unable to load fashion catalog right now.');
      setClothes([]);
      setBrokenImageIds(new Set());
      setLoading(false);
    }
  }, [categoryField, humanizeText, loadCatalogMetadata, normalizeCloth, productSource]);

  const fetchCategories = useCallback(async (sourceOverride) => {
    try {
      const source = sourceOverride || productSource;

      if (source === CATALOG_SOURCE) {
        const catalog = await loadCatalogMetadata();
        setCategoryField('subcategory');
        setCategories([
          ...new Set(catalog.map((item) => item.subcategory || item.category).filter(Boolean))
        ]);
        return;
      }

      if (source === DRESSCODE_SOURCE) {
        const demoArticleTypes = DRESSCODE_DEMO_CLOTHES.map((item) => item.articleType).filter(Boolean);
        const demoSubcategories = DRESSCODE_DEMO_CLOTHES.map((item) => item.subcategory).filter(Boolean);

        try {
          const response = await fetch(`${API_URL}/api/clothes/meta/categories?source=${encodeURIComponent(source)}&scope=tryon`);
          if (!response.ok) {
            throw new Error(`Failed to load categories (${response.status})`);
          }
          const data = await response.json();
          const articleTypes = Array.isArray(data.articleTypes) ? data.articleTypes.filter(Boolean) : [];
          const subcategories = Array.isArray(data.subcategories) ? data.subcategories.filter(Boolean) : [];

          if (articleTypes.length > 0) {
            setCategoryField('articleType');
            setCategories([...new Set([...articleTypes, ...demoArticleTypes])]);
            return;
          }

          setCategoryField('subcategory');
          setCategories([...new Set([...subcategories, ...demoSubcategories])]);
          return;
        } catch (error) {
          console.error('Error fetching categories:', error);
          setCategoryField('subcategory');
          setCategories([...new Set(demoSubcategories)]);
          return;
        }
      }

      if (source === LOCAL_SVG_SOURCE) {
        setCategoryField('subcategory');
        setCategories([...new Set(DRESSCODE_DEMO_CLOTHES.map((item) => item.subcategory).filter(Boolean))]);
        return;
      }

      const response = await fetch(`${API_URL}/api/clothes/meta/categories?source=${encodeURIComponent(source)}&scope=tryon`);
      if (!response.ok) {
        throw new Error(`Failed to load categories (${response.status})`);
      }
      const data = await response.json();
      const articleTypes = Array.isArray(data.articleTypes) ? data.articleTypes.filter(Boolean) : [];
      const subcategories = Array.isArray(data.subcategories) ? data.subcategories.filter(Boolean) : [];

      if (articleTypes.length > 0) {
        setCategoryField('articleType');
        setCategories(articleTypes);
        return;
      }

      setCategoryField('subcategory');
      setCategories(subcategories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setCategories([]);
    }
  }, [loadCatalogMetadata, productSource]);

  useEffect(() => {
    fetchClothes('all', null, productSource);
    fetchCategories(productSource);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [fetchCategories, fetchClothes, productSource]);

  const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    fetchClothes(category, searchTerm);
  };

  const handleSourceChange = (source) => {
    setProductSource(source);
    setSelectedCategory('all');
    setSearchTerm('');
    fetchClothes('all', null, source);
    fetchCategories(source);
  };

  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      fetchClothes(selectedCategory, term);
    }, 300);
  };

  const handleSelect = (cloth) => {
    onSelect(cloth);
    emitClothSelected(cloth.id);
  };

  const normalizeGender = useCallback((value = '') => {
    const text = String(value).toLowerCase().trim();
    if (!text) return '';
    if (text === 'man' || text === 'male' || text === 'mens' || text === 'men') return 'men';
    if (text === 'woman' || text === 'female' || text === 'womens' || text === 'women') return 'women';
    if (text.includes('unisex')) return 'unisex';
    return text;
  }, []);

  const inferAudience = useCallback((cloth) => {
    const direct = normalizeGender(cloth.gender);
    if (direct === 'men' || direct === 'women' || direct === 'unisex') {
      return direct;
    }

    const lookup = [
      cloth.name,
      cloth.category,
      cloth.subcategory,
      ...(Array.isArray(cloth.tags) ? cloth.tags : [])
    ].join(' ').toLowerCase();

    if (
      lookup.includes("women's") ||
      lookup.includes(' womens ') ||
      lookup.includes(' women ') ||
      lookup.includes(' female ') ||
      lookup.includes(' ladies ') ||
      lookup.includes(' dress ') ||
      lookup.includes(' blouse ') ||
      lookup.includes(' skirt ')
    ) {
      return 'women';
    }

    if (
      lookup.includes("men's") ||
      lookup.includes(' mens ') ||
      lookup.includes(' men ') ||
      lookup.includes(' male ') ||
      lookup.includes(' gents ')
    ) {
      return 'men';
    }

    return 'unisex';
  }, [normalizeGender]);

  const filteredClothes = useMemo(() => {
    if (selectedAudience === 'all') {
      return clothes;
    }

    return clothes.filter((cloth) => inferAudience(cloth) === selectedAudience);
  }, [clothes, inferAudience, selectedAudience]);

  const formatCategoryLabel = (label = '') => {
    if (!label) return 'Category';
    return label
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  };

  const formatPriceLabel = (price) => {
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) {
      return 'Preview';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <div className="cloth-selector">
      <div className="selector-brand-block">
        <p className="selector-brand">ATELIER</p>
        <h2>Collection</h2>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search styles"
          value={searchTerm}
          onChange={handleSearch}
          className="search-input"
        />
      </div>

      <div className="source-filter">
        {SOURCE_OPTIONS.map((option) => (
          <button
            key={option.id}
            className={`audience-btn ${productSource === option.id ? 'active' : ''}`}
            onClick={() => handleSourceChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="audience-filter">
        {AUDIENCE_OPTIONS.map((option) => (
          <button
            key={option.id}
            className={`audience-btn ${selectedAudience === option.id ? 'active' : ''}`}
            onClick={() => setSelectedAudience(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="category-filter">
        <button
          className={`category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
          onClick={() => handleCategoryChange('all')}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
            onClick={() => handleCategoryChange(cat)}
          >
            {formatCategoryLabel(cat)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading clothes...</div>
      ) : (
        <div className="clothes-grid">
          {filteredClothes.map((cloth) => (
            <article
              key={cloth.id}
              className={`cloth-item ${selectedCloth?.id === cloth.id ? 'selected' : ''}`}
              onClick={() => handleSelect(cloth)}
            >
              <div
                className="cloth-preview"
                style={{ backgroundColor: cloth.color || '#e9e5dd' }}
              >
                {cloth.image && !brokenImageIds.has(cloth.id) ? (
                  <img
                    src={cloth.thumbnail || cloth.image}
                    alt={cloth.name}
                    loading="lazy"
                    onError={(event) => {
                      setBrokenImageIds((prev) => {
                        const next = new Set(prev);
                        next.add(cloth.id);
                        return next;
                      });
                      // Keep the item but swap to a placeholder so the list doesn't disappear.
                      event.currentTarget.onerror = null;
                    }}
                  />
                ) : (
                  <div className="cloth-icon">No image</div>
                )}
              </div>
              <div className="cloth-info">
                <h3>{cloth.name}</h3>
                <p className="cloth-category">{formatCategoryLabel(
                  categoryField === 'articleType'
                    ? cloth.articleType || cloth.subcategory || cloth.category
                    : cloth.subcategory || cloth.category || cloth.articleType
                )}</p>
                <div className="cloth-meta-row">
                  <span className="cloth-brand">
                    {cloth.brand && cloth.brand !== 'Sample' && cloth.brand !== 'Unknown'
                      ? cloth.brand
                      : 'Atelier Line'}
                  </span>
                  <span className="cloth-price">{formatPriceLabel(cloth.price)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {filteredClothes.length === 0 && !loading && (
        <div className="no-results">
          {loadError || 'No styles found for this section. Try another filter.'}
        </div>
      )}
    </div>
  );
};

export default ClothSelector;
