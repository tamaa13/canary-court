import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "@/components/organisms/docs/DocsViews";
import { allDocs, docBySlug } from "@/lib/docs/content";

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const doc = docBySlug((await params).slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const doc = docBySlug((await params).slug);
  if (!doc) notFound();
  return <DocArticle doc={doc} />;
}
