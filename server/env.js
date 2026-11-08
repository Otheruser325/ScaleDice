import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer server/.env for local development while keeping hosted env vars intact.
dotenv.config({ path: path.join(__dirname, '.env') });
// Also allow a repository-root .env if present.
dotenv.config();

export const PORT = Number(process.env.PORT) || 8080;
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export default { PORT, IS_PRODUCTION };
