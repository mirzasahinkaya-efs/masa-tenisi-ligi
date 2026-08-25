// Vercel adapter. See api/me.js — the handlers are Web-standard, so this only
// supplies `env`. One path, three methods: create, correct, remove.
import {
  handleResultPost, handleResultPatch, handleResultDelete,
} from '../functions/api/results.js';

export const POST = (request) => handleResultPost(request, process.env);
export const PATCH = (request) => handleResultPatch(request, process.env);
export const DELETE = (request) => handleResultDelete(request, process.env);
