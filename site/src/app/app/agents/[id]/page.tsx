import type { Metadata } from "next";
import { AgentView } from "@/components/organisms/market/Agents";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id).replace(/\.arifnovrian\.testnet$/, "") };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentView id={decodeURIComponent(id)} />;
}
