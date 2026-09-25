import Link from "next/link";

const LINKS = [
  { href: "/", key: "workbench", label: "Workbench" },
  { href: "/results", key: "results", label: "Results" },
  { href: "/sources", key: "sources", label: "Sources" },
] as const;

/** One bar across every page, so the three surfaces read as one site. */
export default function SiteNav({ current }: { current: (typeof LINKS)[number]["key"] }) {
  return (
    <nav className="sitenav" aria-label="Site">
      <Link href="/" className="wordmark">
        trolley<b>bench</b>
      </Link>
      <ul>
        {LINKS.map((l) => (
          <li key={l.key}>
            <Link href={l.href} aria-current={l.key === current ? "page" : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <a className="gh" href="https://github.com/Sherlemious/trolleybench">
        source
      </a>
    </nav>
  );
}
