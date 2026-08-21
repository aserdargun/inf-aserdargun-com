"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
type Theme = "light" | "dark";
function currentTheme(): Theme { return document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);

  function toggle() {
    if (theme === null) return;
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("inf-theme", next);
    setTheme(next);
  }

  const label = theme === null ? "Color theme" : theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  return (
    <button
      aria-label={label}
      aria-pressed={theme === null ? undefined : theme === "dark"}
      className="theme-toggle"
      disabled={theme === null}
      onClick={toggle}
      title={label}
      type="button"
    >
      {theme === null
        ? <span aria-hidden="true" data-theme-icon="neutral">◐</span>
        : theme === "light"
          ? <Moon aria-hidden="true" size={20} strokeWidth={1.75} />
          : <Sun aria-hidden="true" size={20} strokeWidth={1.75} />}
    </button>
  );
}
