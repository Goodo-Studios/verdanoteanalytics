import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Goodo OS: Instrument Sans, Instrument Serif italic for titles, Source Serif 4 for reading.
        sans: ["var(--gos-sans)"],
        heading: ["var(--gos-sans)"],
        body: ["var(--gos-sans)"],
        serif: ["var(--gos-serif)"],
        read: ["var(--gos-read)"],
        data: ["var(--gos-sans)"],
        mono: ["var(--gos-sans)"],
        label: ["var(--gos-sans)"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        // OS-005: the old Verdanote greens now point at the War Room ink and greys.
        verdant: {
          DEFAULT: "var(--gos-ink)",
          light: "var(--gos-ink)",
          dark: "var(--gos-ink)",
        },
        forest: "hsl(var(--text-heading))",
        sage: {
          DEFAULT: "var(--gos-mut)",
          light: "var(--gos-acc2)",
          dark: "var(--gos-ink)",
        },
        cream: {
          DEFAULT: "var(--gos-bg)",
          dark: "var(--gos-warm)",
        },
        charcoal: "hsl(var(--text-strong))",
        slate: "hsl(var(--text-secondary))",
        gold: {
          DEFAULT: "#D4A843",
          light: "#F5ECD4",
        },
        "border-light": "var(--gos-line)",
        scale: "hsl(var(--scale))",
        watch: "hsl(var(--watch))",
        kill: "hsl(var(--kill))",
        "tag-parsed": "hsl(var(--tag-parsed))",
        "tag-csv": "hsl(var(--tag-csv))",
        "tag-manual": "hsl(var(--tag-manual))",
        "tag-untagged": "hsl(var(--tag-untagged))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "var(--gos-radius-card)",
        panel: "var(--gos-radius-panel)",
        button: "var(--gos-radius-pill)",
        input: "var(--gos-radius-pill)",
      },
      boxShadow: {
        card: "var(--gos-shadow)",
        "card-hover": "var(--gos-shadow-raised)",
        modal: "var(--gos-shadow-raised)",
        focus: "0 0 0 3px rgba(30,30,30,0.15)",
      },
      transitionTimingFunction: {
        gos: "var(--gos-ease)",
      },
      fontSize: {
        page: ["2rem", { lineHeight: "1.1" }],
        section: ["1.5rem", { lineHeight: "1.15" }],
        "card-t": ["1.125rem", { lineHeight: "1.2" }],
        metric: ["1.5rem", { lineHeight: "1.1" }],
        "metric-lg": ["2.25rem", { lineHeight: "1" }],
        data: ["0.875rem", { lineHeight: "1.5" }],
        "data-sm": ["0.8125rem", { lineHeight: "1.4" }],
        label: ["0.6875rem", { lineHeight: "1.4" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease",
        "accordion-up": "accordion-up 0.2s ease",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
