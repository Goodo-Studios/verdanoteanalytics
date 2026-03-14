import type { Config } from "tailwindcss";

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
        sans: ['"Outfit"', "sans-serif"],
        heading: ['"Libre Caslon Display"', "serif"],
        body: ['"Outfit"', "sans-serif"],
        data: ['"Crimson Pro"', "serif"],
        mono: ['"Crimson Pro"', "serif"],
        label: ['"Space Grotesk"', "sans-serif"],
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
        verdant: {
          DEFAULT: "#1B7A4E",
          light: "#22965F",
          dark: "#156B42",
        },
        forest: "#0D3B25",
        sage: {
          DEFAULT: "#6B9A7E",
          light: "#E8F5EE",
          dark: "#578568",
        },
        cream: {
          DEFAULT: "#FDF8F0",
          dark: "#F5EFE3",
        },
        charcoal: "hsl(var(--text-strong))",
        slate: "hsl(var(--text-secondary))",
        gold: {
          DEFAULT: "#D4A843",
          light: "#F5ECD4",
        },
        "border-light": "#E2EDE7",
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
        card: "8px",
        button: "6px",
        input: "4px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(13,59,37,0.06), 0 1px 2px rgba(13,59,37,0.04)",
        "card-hover": "0 4px 12px rgba(13,59,37,0.08), 0 2px 4px rgba(13,59,37,0.04)",
        modal: "0 12px 40px rgba(13,59,37,0.12), 0 4px 12px rgba(13,59,37,0.06)",
        focus: "0 0 0 3px rgba(27,122,78,0.2)",
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
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
