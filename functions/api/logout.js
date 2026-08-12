import { clearedCookie } from '../_shared/http.js';

export const onRequestGet = () => new Response(null, {
  status: 302,
  headers: { location: '/', 'set-cookie': clearedCookie() },
});
