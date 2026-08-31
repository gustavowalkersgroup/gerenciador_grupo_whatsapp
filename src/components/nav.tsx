"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        // "/" só é ativo na raiz; as demais valem para as subrotas
        // (ex: /grupos/abc mantém "Grupos" destacado).
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "whitespace-nowrap rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-accent"
                : "whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
