"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [string, string][] = [
  ["/ops", "Overview"],
  ["/ops/inventory", "Inventory"],
  ["/ops/orders", "Orders"],
  ["/ops/returns", "Returns"],
  ["/ops/exceptions", "Exceptions"],
  ["/ops/finance", "Finance and escrow"],
  ["/ops/liquidity", "Liquidity"],
  ["/ops/catalogue", "Catalogue"],
  ["/ops/pricing", "Business settings"],
  ["/ops/hubs", "Hubs"],
  ["/ops/users", "Users"],
  ["/ops/support", "Support inbox"],
  ["/ops/metrics", "Metrics"],
  ["/ops/audit", "Audit log"],
  ["/ops/jobs", "Jobs and demo"],
  ["/ops/mail-log", "Mail log"],
];

/** O-01 console navigation; the current page is marked for assistive tech, not by colour only. */
export default function OpsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Operations" className="ops-nav surface">
      {LINKS.map(([href, label]) => {
        const current = href === "/ops" ? path === "/ops" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={current ? "ops-link current" : "ops-link"}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
