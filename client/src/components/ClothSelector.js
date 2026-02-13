import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { emitClothSelected } from '../services/socket';
import './ClothSelector.css';

const API_URL = process.env.REACT_APP_API_URL
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');
const PRODUCT_SOURCE = process.env.REACT_APP_PRODUCT_SOURCE || 'fashion-product-images-kaggle';

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
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimeoutRef = useRef(null);

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
      image: imageUrl,
      thumbnail: thumbnailUrl,
      sourceId: cloth.sourceId || cloth.source_id || cloth.externalId || cloth.external_id || null,
      source: cloth.source || PRODUCT_SOURCE,
      subcategory,
      articleType
    };
  }, []);

  const fetchClothes = useCallback(async (category = null, search = null) => {
    try {
      setLoading(true);
      setLoadError('');
      let url = `${API_URL}/api/clothes?limit=50&source=${encodeURIComponent(PRODUCT_SOURCE)}&scope=tryon`;
      
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
      setLoading(false);
    } catch (error) {
      console.error('Error fetching clothes:', error);
      setLoadError('Unable to load fashion catalog right now.');
      setClothes([]);
      setLoading(false);
    }
  }, [categoryField, normalizeCloth]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/clothes/meta/categories?source=${encodeURIComponent(PRODUCT_SOURCE)}&scope=tryon`);
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
  }, []);

  useEffect(() => {
    fetchClothes();
    fetchCategories();
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [fetchCategories, fetchClothes]);

  const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    fetchClothes(category, searchTerm);
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
                {cloth.image ? (
                  <img
                    src={cloth.thumbnail || cloth.image}
                    alt={cloth.name}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="cloth-icon">Preview</div>
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
