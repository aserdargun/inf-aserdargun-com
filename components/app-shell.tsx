import type { ReactNode } from "react";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
export function AppShell({ children }: { children: ReactNode }) { return <div className="app-shell"><SidebarNav /><MobileNav /><main className="app-main">{children}</main></div>; }
