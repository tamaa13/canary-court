import type { Metadata } from "next";
import { ProofTab } from "@/components/organisms/market/Tabs";

export const metadata: Metadata = { title: "Proof" };

export default function ProofPage() {
  return <ProofTab />;
}
