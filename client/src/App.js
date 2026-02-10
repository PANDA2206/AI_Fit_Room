import React, { useState, useEffect } from 'react';
import './App.css';
import CameraFeed from './components/CameraFeed';
import ClothSelector from './components/ClothSelector';
import CustomerQueryChat from './components/CustomerQueryChat';
import { connectSocket, disconnectSocket } from './services/socket';

function App() {
  const [selectedCloth, setSelectedCloth] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

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
        <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot" />
          {isConnected ? 'System Online' : 'System Offline'}
        </div>
      </header>
      
      <div className="app-container">
        <ClothSelector onSelect={handleClothSelect} selectedCloth={selectedCloth} />
        <CameraFeed selectedCloth={selectedCloth} />
        <CustomerQueryChat />
      </div>
    </div>
  );
}

export default App;
