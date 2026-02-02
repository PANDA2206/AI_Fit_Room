const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Sample clothes data
app.get('/api/clothes', (req, res) => {
  const clothes = [
    {
      id: 1,
      name: 'Blue T-Shirt',
      category: 'top',
      image: '/uploads/tshirt1.png',
      color: '#4A90E2'
    },
    {
      id: 2,
      name: 'Red Hoodie',
      category: 'top',
      image: '/uploads/hoodie1.png',
      color: '#E24A4A'
    },
    {
      id: 3,
      name: 'White Shirt',
      category: 'top',
      image: '/uploads/shirt1.png',
      color: '#FFFFFF'
    }
  ];
  res.json(clothes);
});

// Socket.IO for real-time communication
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Receive video frame from client
  socket.on('video-frame', (data) => {
    // Process the frame (you can add body detection here)
    // For now, just echo it back
    socket.emit('processed-frame', {
      frame: data.frame,
      timestamp: Date.now()
    });
  });

  // Handle cloth selection
  socket.on('cloth-selected', (data) => {
    console.log('Cloth selected:', data);
    socket.emit('cloth-applied', {
      clothId: data.clothId,
      success: true
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});
