import type { Metadata } from "next";
import { AgentsList } from "@/components/organisms/market/Agents";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsList />;
}
