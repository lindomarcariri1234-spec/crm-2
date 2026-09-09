import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type RouteSmokeCase = {
  name: string;
  path: string;
  importPath: string;
  load: () => Promise<{ default: unknown }>;
};

const appSource = readFileSync(
  path.resolve(import.meta.dirname, "../App.tsx"),
  "utf8",
);

// Keep these paths aligned with the routes users actually enter. The source
// assertions prevent this smoke test from quietly drifting to a parallel list
// that no longer represents App.tsx.
const routeSmokeCases: RouteSmokeCase[] = [
  {
    name: "página pública",
    path: "/",
    importPath: "@/pages/landing",
    load: () => import("../pages/landing"),
  },
  {
    name: "área da agência",
    path: "/dashboard",
    importPath: "@/pages/dashboard",
    load: () => import("../pages/dashboard"),
  },
  {
    name: "área de superadmin",
    path: "/admin",
    importPath: "@/pages/admin/index",
    load: () => import("../pages/admin/index"),
  },
  {
    name: "portal do cliente",
    path: "/perfil",
    importPath: "@/pages/perfil/index",
    load: () => import("../pages/perfil/index"),
  },
  {
    name: "vitrine pública",
    path: "/loja/:slug",
    importPath: "@/pages/vitrine",
    load: () => import("../pages/vitrine"),
  },
];

describe("rotas carregadas sob demanda", () => {
  it.each(routeSmokeCases)(
    "mantém o caminho real e o import lazy de $name",
    async ({ path, importPath, load }) => {
      expect(appSource).toContain(`path="${path}"`);
      expect(appSource).toContain(`import("${importPath}")`);

      const routeModule = await load();

      expect(routeModule.default).toBeTypeOf("function");
    },
  );
});