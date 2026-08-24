// Vercel adapter. See api/me.js — logout needs neither the request nor env.
import { onRequestGet } from '../functions/api/logout.js';

export const GET = () => onRequestGet();
