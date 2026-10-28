import { io } from 'socket.io-client';

const SOCKET_URL = '/';

const socket = io(SOCKET_URL, {
  autoConnect: false,
  auth: () => {
    const token = localStorage.getItem('cf_token');
    return { token };
  },
});

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
}

export function joinListing(listingId) {
  socket.emit('listing:join', { listingId });
}

export function leaveListing(listingId) {
  socket.emit('listing:leave', { listingId });
}

export default socket;
