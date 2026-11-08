import './env.js';
import { createOnlineServer } from './app.js';
import { PORT, IS_PRODUCTION } from './env.js';
import { userStorageMode } from './utils/userStorage.js';

const { httpServer, io, lobbyManager, closeRedis } = await createOnlineServer();

// Restore persisted lobbies before accepting connections. In memory mode this
// is immediate; in Supabase mode it is a bounded startup read.
await lobbyManager.init();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Scale Dice online server listening on http://localhost:${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Auth: guest=on google=${process.env.GOOGLE_CLIENT_ID ? 'on' : 'off'} discord=${process.env.DISCORD_CLIENT_ID ? 'on' : 'off'}`);
  console.log(`[Server] Online storage: users=${userStorageMode} lobbies=${lobbyManager.storageMode}`);
  if (IS_PRODUCTION) {
    console.log('[Server] Production mode: set SESSION_SECRET, CLIENT_ORIGINS and TRUST_PROXY for a shared deployment');
  }
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[Server] ${signal} received, shutting down`);
  lobbyManager.dispose();
  io.close();
  await closeRedis();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { httpServer, io, lobbyManager };
