// Vercel adapter. See api/me.js — this handler reads only env.
import { handleLeagueGet } from '../functions/api/league.js';

export const GET = () => handleLeagueGet(process.env);
