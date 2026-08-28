import type { Metadata } from 'next';
import Link from 'next/link';
import AgentGuide from '../../components/floortris/AgentGuide';

export const metadata: Metadata = { title: 'Floortris — Native WebMCP agent guide', description: 'Connect to the human’s planner tab, generate a visible proposal with native WebMCP, and leave Apply to the human.' };

export default function GuidePage() {
  return <main className="ft-agent-guide-page"><Link href="/">← Open the planner</Link><h1>WebMCP → Proposal → human review</h1><p>Floortris agent workflow</p><AgentGuide /></main>;
}
