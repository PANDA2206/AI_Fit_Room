import React, { useMemo, useState, useEffect, useRef } from 'react';
import { emitClothSelected } from '../services/socket';
import './ClothSelector.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const AUDIENCE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'women', label: 'Women' },
  { id: 'men', label: 'Men' },
  { id: 'unisex', label: 'Unisex' }
];

const ClothSelector = ({ onSelect, selectedCloth }) => {
  const [clothes, setClothes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedAudience, setSelectedAudience] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    fetchClothes();
    fetchCategories();
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const fetchClothes = async (category = null, search = null) => {
    try {
      setLoading(true);
      let url = `${API_URL}/api/clothes?limit=50`;
      
      if (category && category !== 'all') {
        url += `&subcategory=${category}`;
      }
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }

      const response = await fetch(url);
      const result = await response.json();
      
      // Handle paginated response
      const clothesData = result.data || result;
      setClothes(clothesData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching clothes:', error);
      // Fallback to local SVG clothes
      const fallbackClothes = [
        { id: 1, name: 'Blue T-Shirt', category: 'top', subcategory: 'tshirt', color: '#4A90D9', image: '/clothes/blue-tshirt.svg' },
        { id: 2, name: 'Red Hoodie', category: 'top', subcategory: 'hoodie', color: '#E74C3C', image: '/clothes/red-hoodie.svg' },
        { id: 3, name: 'White Shirt', category: 'top', subcategory: 'shirt', color: '#FFFFFF', image: '/clothes/white-shirt.svg' },
        { id: 4, name: 'Green Jacket', category: 'top', subcategory: 'jacket', color: '#27AE60', image: '/clothes/green-jacket.svg' },
        { id: 5, name: 'Purple Sweater', category: 'top', subcategory: 'sweater', color: '#9B59B6', image: '/clothes/purple-sweater.svg' },
        { id: 6, name: 'Yellow Vest', category: 'top', subcategory: 'vest', color: '#F1C40F', image: '/clothes/yellow-vest.svg' }
      ];
      setClothes(fallbackClothes);
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_URL}/api/clothes/meta/categories`);
      const data = await response.json();
      setCategories(data.subcategories || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setCategories(['tshirt', 'hoodie', 'shirt', 'jacket', 'sweater', 'vest']);
    }
  };

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

  const normalizeGender = (value = '') => {
    const text = String(value).toLowerCase().trim();
    if (!text) return '';
    if (text === 'man' || text === 'male' || text === 'mens' || text === 'men') return 'men';
    if (text === 'woman' || text === 'female' || text === 'womens' || text === 'women') return 'women';
    if (text.includes('unisex')) return 'unisex';
    return text;
  };

  const inferAudience = (cloth) => {
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
  };

  const filteredClothes = useMemo(() => {
    if (selectedAudience === 'all') {
      return clothes;
    }

    return clothes.filter((cloth) => inferAudience(cloth) === selectedAudience);
  }, [clothes, selectedAudience]);

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
                  <img src={cloth.image} alt={cloth.name} />
                ) : (
                  <div className="cloth-icon">Preview</div>
                )}
              </div>
              <div className="cloth-info">
                <h3>{cloth.name}</h3>
                <p className="cloth-category">{formatCategoryLabel(cloth.subcategory || cloth.category)}</p>
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
          No styles found for this section. Try another filter.
        </div>
      )}
    </div>
  );
};

export default ClothSelector;
