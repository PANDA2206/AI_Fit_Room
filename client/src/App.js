import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import CameraFeed from './components/CameraFeed';
import ClothSelector from './components/ClothSelector';
import CustomerQueryChat from './components/CustomerQueryChat';
import CartPage from './components/CartPage';
import * as cartService from './services/cart';
import { connectSocket, disconnectSocket } from './services/socket';

function App() {
  const [selectedCloth, setSelectedCloth] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [view, setView] = useState('tryon');
  const [cartItems, setCartItems] = useState([]);

  const refreshCart = useCallback(async () => {
    try {
      const data = await cartService.getCart();
      setCartItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error('Unable to load cart', error);
      setCartItems([]);
    }
  }, []);

  const updateQuantity = useCallback(async (id, delta) => {
    try {
      const current = cartItems.find((item) => item.id === id);
      const nextQty = Math.max(1, (current?.quantity || 1) + delta);
      const data = await cartService.updateItem({ productId: id, quantity: nextQty });
      setCartItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error('Unable to update cart quantity', error);
    }
  }, [cartItems]);

  const removeFromCart = useCallback(async (id) => {
    try {
      const data = await cartService.removeItem(id);
      setCartItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error('Unable to remove cart item', error);
    }
  }, []);

  const clearCart = useCallback(async () => {
    try {
      const data = await cartService.clearCart();
      setCartItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error('Unable to clear cart', error);
    }
  }, []);

  useEffect(() => {
    // Connect to WebSocket server
    const socket = connectSocket();
    
    socket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  useEffect(() => {
    const handleCartUpdated = () => refreshCart();
    window.addEventListener('cart-updated', handleCartUpdated);
    return () => window.removeEventListener('cart-updated', handleCartUpdated);
  }, [refreshCart]);

  const handleClothSelect = (cloth) => {
    setSelectedCloth(cloth);
    console.log('Selected cloth:', cloth);
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-brand">
          <p className="header-eyebrow">Atelier Session</p>
          <h1>Virtual Try-On</h1>
        </div>
        <div className="header-actions">
          <div className="view-toggle">
            <button
              type="button"
              className={view === 'tryon' ? 'active' : ''}
              onClick={() => setView('tryon')}
            >
              Try-On
            </button>
            <button
              type="button"
              className={view === 'cart' ? 'active' : ''}
              onClick={() => {
                setView('cart');
                refreshCart();
              }}
            >
              Cart / Checkout {cartItems.length > 0 ? `(${cartItems.length})` : ''}
            </button>
          </div>
          <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {isConnected ? 'System Online' : 'System Offline'}
          </div>
        </div>
      </header>
      
      {view === 'tryon' ? (
        <div className="app-container">
          <ClothSelector onSelect={handleClothSelect} selectedCloth={selectedCloth} />
          <CameraFeed selectedCloth={selectedCloth} />
          <CustomerQueryChat />
        </div>
      ) : (
        <CartPage
          items={cartItems}
          onUpdateQuantity={updateQuantity}
          onRemove={removeFromCart}
          onClear={clearCart}
        />
      )}
    </div>
  );
}

export default App;
