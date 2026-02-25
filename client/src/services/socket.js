import { io } from 'socket.io-client';

const DEFAULT_SOCKET_URL = process.env.NODE_ENV === 'production'
  ? 'https://ai-fit-room.onrender.com'
  : 'http://localhost:5001';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || DEFAULT_SOCKET_URL;

let socket = null;

export const connectSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;

export const emitVideoFrame = (frameData) => {
  if (socket && socket.connected) {
    socket.emit('video-frame', { frame: frameData });
  }
};

export const emitClothSelected = (clothId) => {
  if (socket && socket.connected) {
    socket.emit('cloth-selected', { clothId });
  }
};

const socketService = {
  connectSocket,
  disconnectSocket,
  getSocket,
  emitVideoFrame,
  emitClothSelected
};

export default socketService;
