try {
  const storedTheme = globalThis.localStorage.getItem("inf-theme");
  globalThis.document.documentElement.dataset.theme = storedTheme === "dark" || storedTheme === "light"
    ? storedTheme
    : globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
} catch { /* The client component safely falls back to light. */ }
