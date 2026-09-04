"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
type Theme = "light" | "dark";
interface ThemeToggleProps { presentation?: "icon" | "row"; }
const themeChangeEvent = "inf-theme-change";
function currentTheme(): Theme { return document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
export function ThemeToggle({ presentation = "icon" }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const synchronize = () => setTheme(currentTheme());
    synchronize();
    window.addEventListener(themeChangeEvent, synchronize);
    window.addEventListener("storage", synchronize);
    return () => {
      window.removeEventListener(themeChangeEvent, synchronize);
      window.removeEventListener("storage", synchronize);
    };
  }, []);

  function toggle() {
    if (theme === null) return;
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("inf-theme", next);
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  const label = theme === null ? "Color theme" : theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  const icon = theme === null
    ? <span aria-hidden="true" data-theme-icon="neutral">◐</span>
    : theme === "light"
      ? <Moon aria-hidden="true" size={20} strokeWidth={1.75} />
      : <Sun aria-hidden="true" size={20} strokeWidth={1.75} />;
  return (
    <button
      aria-label={label}
      aria-pressed={theme === null ? undefined : theme === "dark"}
      className={`theme-toggle theme-toggle--${presentation}`}
      disabled={theme === null}
      onClick={toggle}
      title={label}
      type="button"
    >
      <span className="theme-toggle__label">{presentation === "row" ? label : null}</span>
      {icon}
    </button>
  );
}
