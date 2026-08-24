// Vercel adapter. The handler is Web-standard — (Request, env) => Response — so
// this only supplies `env`, which Cloudflare passes in and Vercel exposes as
// process.env. The logic lives in functions/ and is shared by both hosts.
import { handleCallback } from '../functions/api/callback.js';

export const GET = (request) => handleCallback(request, process.env);
