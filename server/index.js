const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const clothesRoutes = require('./routes/clothes');
const ragRoutes = require('./routes/rag');
const chatRoutes = require('./routes/chat');

const app = express();
const server = http.createServer(app);
const configuredOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = configuredOrigins.length > 0 ? configuredOrigins : true;

const io = socketIo(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/clothes', express.static(path.join(__dirname, '../clothes')));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Clothes API routes
app.use('/api/clothes', clothesRoutes);
app.use('/api/rag', ragRoutes);
app.use('/api/chat', chatRoutes);

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
