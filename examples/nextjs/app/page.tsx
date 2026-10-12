import Link from "next/link";
import { ARTICLES } from "./articles/data";

export default function Home() {
  return (
    <main>
      <h1>crawl402 example</h1>
      <p>Humans read for free. AI crawlers pay 0.002 USDC per article. Try it:</p>
      <pre>{`curl -i -A "GPTBot/1.2" http://localhost:3000/articles/${ARTICLES[0].slug}\nnpm run bot`}</pre>
      <ul>
        {ARTICLES.map((a) => (
          <li key={a.slug}>
            <Link href={`/articles/${a.slug}`}>{a.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
