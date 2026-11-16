import type { Me } from "@certibuy/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import DeniedNotice from "./DeniedNotice";
import ModeSwitch from "./ModeSwitch";

type NavItem = { href: string; label: string };

/** Navigation by role (app_role decides; active_mode never does). Platform admins see everything. */
function navFor(me: Me): NavItem[] {
  const customer = [
    { href: "/seller", label: "Sell" },
    { href: "/shop", label: "Shop" },
    { href: "/help", label: "Help" },
  ];
  const hub = { href: "/hub", label: "Hub" };
  const ops = { href: "/ops", label: "Operations" };
  if (me.isPlatformAdmin) return [ops, hub, ...customer];
  if (me.appRole === "ops") return [ops, hub];
  if (me.appRole === "technician") return [hub];
  return customer;
}

function formatBusinessDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export default function AppShell(props: {
  me: Me;
  businessDate: string;
  demoMode: boolean;
  simulated: boolean;
  children: ReactNode;
}) {
  const { me } = props;
  return (
    <>
      {props.simulated && (
        <div className="demo-banner" role="status">
          Demo — no real money moves
        </div>
      )}
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/" className="brand">
            CertiBuy
          </Link>
          <nav aria-label="Main" className="main-nav">
            {navFor(me).map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="header-controls">
            <span className="date-pill" title="Business date">
              {formatBusinessDate(props.businessDate)}
              {props.demoMode && <span className="sr-only"> (demo clock)</span>}
            </span>
            {me.appRole === "customer" && <ModeSwitch />}
            <Link href="/notifications">Notifications</Link>
            <Link href="/profile">{me.fullName || me.email || "Profile"}</Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="link-button">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <Suspense>
        <DeniedNotice />
      </Suspense>
      <main className="content">{props.children}</main>
    </>
  );
}
