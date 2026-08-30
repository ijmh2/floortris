import type { Metadata } from 'next';
import './globals.css';

const title = 'Floortris — Make room for better';
const description = 'A room planner people and agents share through native WebMCP. Agents create proposals; humans review and Apply.';
/** Static metadata avoids making the otherwise local planner request-dynamic. */
export const metadata: Metadata = {
  metadataBase: new URL('https://floortris.floortris.workers.dev'), title, description,
  openGraph: { title, description, type: 'website', images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Floortris — A room planner people and agents share.' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="help" href="/agent-guide" title="Native WebMCP agent guide" /></head><body>{children}</body></html>;
}
