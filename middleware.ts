import { NextResponse } from 'next/server';

export function middleware() {
  const response = NextResponse.next();
  // Local-only room data needs no permissive browser capabilities. These headers
  // are deliberately compatible with Next/Vinext's inline bootstrap scripts.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  return response;
}

export const config = { matcher: ['/', '/agent-guide'] };
