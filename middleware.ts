import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Replace, never trust, a client/forwarded origin header. The platform-routed
  // request URL supplies the absolute origin for this page's social metadata.
  requestHeaders.set('x-floortris-request-origin', request.nextUrl.origin);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ['/'] };
