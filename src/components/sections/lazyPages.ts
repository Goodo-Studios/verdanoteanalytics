import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { routeImports } from "@/lib/routePrefetch";
import type { PageKey } from "@/lib/sections";

const LAZY = new Map<PageKey, LazyExoticComponent<ComponentType>>();

/** The lazy component for a page key. One lazy wrapper per page, shared by section tabs and the client hub. */
export function pageFor(key: PageKey): LazyExoticComponent<ComponentType> {
  let component = LAZY.get(key);
  if (!component) {
    component = lazy(routeImports[key] as unknown as () => Promise<{ default: ComponentType }>);
    LAZY.set(key, component);
  }
  return component;
}

/** Start loading a page's chunk (hover on a tab). A failed prefetch is ignored: the tab loads it on open. */
export function prefetchPage(key: PageKey): void {
  void (routeImports[key] as () => Promise<unknown>)().catch(() => {});
}
