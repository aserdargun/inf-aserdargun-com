"use client";
import { BookOpen, House, LogOut, Plus, RefreshCw, Settings, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { routes } from "../lib/routes";

const items = [
  ["Today", routes.today, House],
  ["Add", routes.add, Plus],
  ["Library", routes.library, BookOpen],
  ["Review", routes.review, RefreshCw],
  ["Surprise", routes.surprise, Sparkles],
] as const;

const SIGN_OUT_HREF = "/.auth/logout?post_logout_redirect_uri=/login/";

export function MobileNav() {
  const pathname = usePathname();
  return (
    <>
      <header className="mobile-topbar">
        <a className="wordmark" href={routes.today}>Infographics</a>
        <div className="mobile-topbar__actions">
          <a aria-label="Settings" className="mobile-settings" href={routes.settings} title="Settings">
            <Settings aria-hidden="true" size={24} strokeWidth={1.75} />
          </a>
          <a aria-label="Sign out" className="mobile-settings" data-testid="mobile-signout" href={SIGN_OUT_HREF} rel="nofollow" title="Sign out">
            <LogOut aria-hidden="true" size={24} strokeWidth={1.75} />
          </a>
        </div>
      </header>
      <nav aria-label="Primary" className="mobile-nav">
        {items.map(([label, href, Icon]) => {
          const current = href === routes.today ? pathname === href : pathname.startsWith(href.slice(0, -1));
          return (
            <a
              aria-current={current ? "page" : undefined}
              className={current ? "mobile-nav__link is-active" : "mobile-nav__link"}
              href={href}
              key={label}
            >
              <Icon aria-hidden="true" size={24} strokeWidth={1.75} />
              <span>{label}</span>
            </a>
          );
        })}
      </nav>
    </>
  );
}
