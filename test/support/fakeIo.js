// Minimal Socket.IO doubles for exercising LobbyManager without a network.
// They deliberately model the pieces the manager uses: rooms, direct emits,
// broadcasts and the authenticated request user.

export class FakeSocket {
  constructor(id, user, io, address = '127.0.0.1') {
    this.id = id;
    this.io = io;
    this.connected = true;
    this.request = {
      user: user ? { ...user } : null,
      socket: { remoteAddress: address }
    };
    this.handshake = { address };
    this.data = {};
    this.rooms = new Set([id]);
    this.received = [];
    this.handlers = new Map();
  }

  on(event, handler) {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event, payload) {
    this.received.push({ event, payload });
  }

  join(code) {
    this.rooms.add(code);
    this.io._join(this, code);
  }

  leave(code) {
    this.rooms.delete(code);
    this.io._leave(this, code);
  }

  disconnect() {
    this.connected = false;
    this.io._leaveAll(this);
  }

  trigger(event, payload) {
    for (const handler of this.handlers.get(event) || []) handler(payload);
  }

  last(event) {
    for (let i = this.received.length - 1; i >= 0; i -= 1) {
      if (this.received[i].event === event) return this.received[i].payload;
    }
    return undefined;
  }

  count(event) {
    return this.received.filter((entry) => entry.event === event).length;
  }
}

export class FakeIO {
  constructor() {
    this.broadcast = [];
    this._socketMap = new Map();
    this.sockets = {
      sockets: this._socketMap,
      adapter: { rooms: new Map() }
    };
  }

  addSocket(id, user, address) {
    const socket = new FakeSocket(id, user, this, address);
    this._socketMap.set(id, socket);
    this.sockets.adapter.rooms.set(id, new Set([id]));
    return socket;
  }

  _join(socket, code) {
    if (!this.sockets.adapter.rooms.has(code)) this.sockets.adapter.rooms.set(code, new Set());
    this.sockets.adapter.rooms.get(code).add(socket.id);
  }

  _leave(socket, code) {
    const room = this.sockets.adapter.rooms.get(code);
    if (!room) return;
    room.delete(socket.id);
    if (room.size === 0) this.sockets.adapter.rooms.delete(code);
  }

  _leaveAll(socket) {
    for (const code of [...socket.rooms]) this._leave(socket, code);
    socket.rooms.clear();
  }

  to(code) {
    return {
      emit: (event, payload) => {
        this.broadcast.push({ code, event, payload });
        const room = this.sockets.adapter.rooms.get(code) || new Set();
        for (const id of room) {
          const socket = this._socketMap.get(id);
          if (socket) socket.received.push({ event, payload });
        }
      }
    };
  }

  lastBroadcast(event) {
    for (let i = this.broadcast.length - 1; i >= 0; i -= 1) {
      if (this.broadcast[i].event === event) return this.broadcast[i].payload;
    }
    return undefined;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { FakeSocket, FakeIO, sleep };
