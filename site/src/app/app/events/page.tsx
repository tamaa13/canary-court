import type { Metadata } from "next";
import { Events } from "@/components/organisms/market/Events";

export const metadata: Metadata = { title: "Every event" };

export default function EventsPage() {
  return <Events />;
}
