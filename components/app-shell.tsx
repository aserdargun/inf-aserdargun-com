import type { ReactNode } from "react";
import { AdaptiveNavigation } from "./adaptive-navigation";
export function AppShell({ children }: { children: ReactNode }) { return <div className="app-shell"><AdaptiveNavigation /><main className="app-main">{children}</main></div>; }
