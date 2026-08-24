// Vercel adapter. The handler is Web-standard — (Request, env) => Response — so
// this only supplies `env`, which Cloudflare passes in and Vercel exposes as
// process.env. The logic lives in functions/ and is shared by both hosts.
import { handleLogin } from '../functions/api/login.js';

export const GET = (request) => handleLogin(request, process.env);
