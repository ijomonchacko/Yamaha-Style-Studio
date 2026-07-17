import { useCallback, useEffect, useState } from "react";
import { LandingPage } from "./components/landing/LandingPage";
import { DocsPage } from "./components/docs/DocsPage";
import { StudioApp } from "./StudioApp";
import { SiteNav } from "./components/SiteNav";
import "./landing.css";
import "./site-nav.css";

type Route = "home" | "studio" | "docs";

function pathToRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (p === "/studio" || p === "/app" || p === "/launch") return "studio";
  if (p === "/docs" || p === "/documentation" || p === "/guide") return "docs";
  return "home";
}

function routeToPath(route: Route): string {
  if (route === "studio") return "/studio";
  if (route === "docs") return "/docs";
  return "/";
}

function getRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash === "studio" || hash === "app" || hash === "launch") return "studio";
  if (hash === "docs" || hash === "documentation" || hash === "guide") return "docs";
  return pathToRoute(window.location.pathname);
}

function scrollToId(id: string) {
  if (id === "hero" || id === "home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Root router + single shared fixed SiteNav for home · docs · studio.
 */
export default function App() {
  const [route, setRoute] = useState<Route>(() => getRoute());

  useEffect(() => {
    const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
    let next: Route | null = null;
    if (hash === "studio" || hash === "app" || hash === "launch") next = "studio";
    else if (hash === "docs" || hash === "documentation" || hash === "guide") next = "docs";

    if (next) {
      const path = routeToPath(next);
      window.history.replaceState({ route: next }, "", path);
      setRoute(next);
    } else if (window.location.hash) {
      window.history.replaceState({ route: getRoute() }, "", routeToPath(getRoute()));
    }

    const onPop = () => setRoute(getRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    const path = routeToPath(next);
    if (window.location.pathname !== path || window.location.hash) {
      window.history.pushState({ route: next }, "", path);
    }
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  const goStudio = useCallback(() => navigate("studio"), [navigate]);
  const goHome = useCallback(() => navigate("home"), [navigate]);
  const goDocs = useCallback(() => navigate("docs"), [navigate]);

  const nav =
    route === "home" ? (
      <SiteNav
        tone="dark"
        hideOnScroll
        hideWhenPastId="hero"
        onLogoClick={() => scrollToId("hero")}
        onPrimary={goStudio}
        primaryLabel="Launch Studio"
        secondaryLabel="Docs"
        onSecondary={goDocs}
        links={[
          { id: "home", label: "Home", onClick: () => scrollToId("hero"), active: true },
          { id: "features", label: "Features", onClick: () => scrollToId("features") },
          { id: "live-audio", label: "Live Audio", onClick: () => scrollToId("live-audio") },
          { id: "midi", label: "MIDI Editor", onClick: () => scrollToId("midi") },
          { id: "community", label: "Community", onClick: () => scrollToId("community") }
        ]}
      />
    ) : route === "docs" ? (
      <SiteNav
        tone="light"
        hideOnScroll={false}
        onLogoClick={goHome}
        onPrimary={goStudio}
        primaryLabel="Launch Studio"
        links={[
          { id: "home", label: "Home", onClick: goHome },
          { id: "docs", label: "Docs", onClick: () => scrollToId("overview"), active: true },
          { id: "studio", label: "Studio", onClick: goStudio }
        ]}
      />
    ) : null;

  return (
    <>
      {/* Studio owns its own full-width fixed chrome — no floating SiteNav pill */}
      {route !== "studio" && nav}
      {route === "studio" && <StudioApp onBackHome={goHome} onOpenDocs={goDocs} />}
      {route === "docs" && <DocsPage onHome={goHome} onLaunchStudio={goStudio} />}
      {route === "home" && <LandingPage onLaunchStudio={goStudio} onOpenDocs={goDocs} />}
    </>
  );
}
