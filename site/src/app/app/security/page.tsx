import { redirect } from "next/navigation";

// (Security is now part of Proof: old links keep their part and page)
export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  redirect(`/app/proof${q.size ? `?${q}` : ""}`);
}
