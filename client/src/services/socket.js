import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5001');

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

export default {
  connectSocket,
  disconnectSocket,
  getSocket,
  emitVideoFrame,
  emitClothSelected
};
