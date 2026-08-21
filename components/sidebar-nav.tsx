"use client";
import { BookOpen, House, Inbox, Plus, RefreshCw, Settings, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { routes } from "../lib/routes";
import { ThemeToggle } from "./theme-toggle";
const primaryItems = [["Today", routes.today, House], ["Inbox", routes.inbox, Inbox], ["Library", routes.library, BookOpen], ["Add", routes.add, Plus], ["Review", routes.review, RefreshCw], ["Surprise", routes.surprise, Sparkles]] as const;
function isCurrent(pathname: string, href: string) { return href === routes.today ? pathname === href : pathname.startsWith(href.slice(0, -1)); }
export function SidebarNav() { const pathname = usePathname(); return <aside className="sidebar" aria-label="Owner navigation"><a className="wordmark" href={routes.today}>INF</a><nav aria-label="Primary">{primaryItems.map(([label, href, Icon]) => <a aria-current={isCurrent(pathname, href) ? "page" : undefined} className={isCurrent(pathname, href) ? "nav-link is-active" : "nav-link"} href={href} key={label}><Icon aria-hidden="true" size={20} strokeWidth={1.75} /><span>{label}</span></a>)}</nav><div className="sidebar__footer"><a aria-current={isCurrent(pathname, routes.settings) ? "page" : undefined} className={isCurrent(pathname, routes.settings) ? "nav-link is-active" : "nav-link"} href={routes.settings}><Settings aria-hidden="true" size={20} strokeWidth={1.75} /><span>Settings</span></a><ThemeToggle /></div></aside>; }
