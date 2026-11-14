import type { Metadata } from "next";
import { Market } from "@/components/organisms/market/Market";

export const metadata: Metadata = {
  title: "Market",
  description: "Canary Court on NEAR testnet, as it happens: your agent, the bots being tested right now, and what came of it, read from the chain.",
};

export default function MarketPage() {
  return <Market />;
}
