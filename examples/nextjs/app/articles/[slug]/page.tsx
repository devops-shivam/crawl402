import { notFound } from "next/navigation";
import { ARTICLES } from "../data";

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = ARTICLES.find((a) => a.slug === slug);
  if (!article) notFound();
  return (
    <article>
      <h1>{article.title}</h1>
      <p>{article.body}</p>
    </article>
  );
}
