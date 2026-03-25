"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface ThemeToggleProps {
  className?: string;
  size?: "sm" | "default";
}

export function ThemeToggle({ className, size = "default" }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative overflow-hidden transition-all duration-300",
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        className
      )}
      aria-label="Toggle theme"
    >
      <Sun
        className={cn(
          "absolute h-4 w-4 transition-all duration-300",
          isDark ? "opacity-0 rotate-90 scale-0" : "opacity-100 rotate-0 scale-100"
        )}
      />
      <Moon
        className={cn(
          "absolute h-4 w-4 transition-all duration-300",
          isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-0"
        )}
      />
    </Button>
  );
}
