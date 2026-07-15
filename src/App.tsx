import { useCallback, useEffect, useState } from "react";
import { LandingPage } from "./components/landing/LandingPage";
import { DocsPage } from "./components/docs/DocsPage";
import { StudioApp } from "./StudioApp";
import "./landing.css";

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
  // Prefer clean path URLs; migrate legacy hash routes once.
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash === "studio" || hash === "app" || hash === "launch") return "studio";
  if (hash === "docs" || hash === "documentation" || hash === "guide") return "docs";
  return pathToRoute(window.location.pathname);
}

/**
 * Root router: home · docs · studio
 * Clean paths: `/` home, `/docs` documentation, `/studio` studio.
 */
export default function App() {
  const [route, setRoute] = useState<Route>(() => getRoute());

  useEffect(() => {
    // Migrate #/studio → /studio (and clear hash)
    const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
    let next: Route | null = null;
    if (hash === "studio" || hash === "app" || hash === "launch") next = "studio";
    else if (hash === "docs" || hash === "documentation" || hash === "guide") next = "docs";
    else if (hash === "" || hash === "/") {
      // hash home with non-root path already handled by pathname
    }

    if (next) {
      const path = routeToPath(next);
      window.history.replaceState({ route: next }, "", path);
      setRoute(next);
    } else if (window.location.hash) {
      // Drop leftover hashes on clean paths
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

  if (route === "studio") {
    return <StudioApp onBackHome={goHome} />;
  }

  if (route === "docs") {
    return <DocsPage onHome={goHome} onLaunchStudio={goStudio} />;
  }

  return <LandingPage onLaunchStudio={goStudio} onOpenDocs={goDocs} />;
}
