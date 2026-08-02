import { createContext, useEffect, ReactNode } from "react";

interface ThemeContextValue {
  theme: "light";
}

const ThemeContext = createContext<ThemeContextValue>({ theme: "light" });

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Ensure dark class is never present
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("verdanote-theme");
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: "light" }}>
      {children}
    </ThemeContext.Provider>
  );
}
