const DEFAULT_API_URL = process.env.NODE_ENV === 'production'
  ? 'https://ai-fit-room.onrender.com'
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');

const API_URL = process.env.REACT_APP_API_URL || DEFAULT_API_URL;

const CART_TOKEN_KEY = 'guestCartToken';

const getGuestToken = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CART_TOKEN_KEY);
};

const storeGuestToken = (token) => {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(CART_TOKEN_KEY, token);
  }
};

async function request(path, { method = 'GET', body } = {}) {
  const guestToken = getGuestToken();
  const headers = { 'Content-Type': 'application/json' };
  if (guestToken) {
    headers['x-guest-token'] = guestToken;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (data?.guestToken) {
    storeGuestToken(data.guestToken);
  }

  if (!response.ok) {
    const message = data?.error || data?.detail || 'Cart request failed';
    const error = new Error(message);
    error.payload = data;
    throw error;
  }

  return data;
}

export const getCart = () => request('/api/cart');

export const addItem = ({ productId, quantity = 1 }) => request('/api/cart/items', {
  method: 'POST',
  body: { productId, quantity }
});

export const updateItem = ({ productId, quantity = 1 }) => request(`/api/cart/items/${encodeURIComponent(productId)}`, {
  method: 'PUT',
  body: { quantity }
});

export const removeItem = (productId) => request(`/api/cart/items/${encodeURIComponent(productId)}`, {
  method: 'DELETE'
});

export const clearCart = () => request('/api/cart/clear', {
  method: 'POST'
});

const cartService = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart
};

export default cartService;
