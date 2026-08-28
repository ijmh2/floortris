import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('x-floortris-request-origin') || 'http://localhost:3001';
  const image = new URL('/og.png', origin).href;
  const title = 'Floortris — Make room for better';
  const description = 'A room planner people and agents share through native WebMCP. Agents use generateRoom to create proposals; humans review and Apply.';
  return {
    metadataBase: new URL(origin), title, description,
    openGraph: { title, description, type: 'website', images: [{ url: image, width: 1731, height: 909, alt: 'Floortris — A room planner people and agents share.' }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="help" href="/agent-guide" title="Native WebMCP agent guide" /></head><body>{children}</body></html>;
}
