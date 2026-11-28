/**
 * MDX globals registry — components available inside MDX without `import`.
 * Wired via `<Content components={components} />` in `[...slug].astro`.
 * Add new components here as you build (or install) them.
 */

import { Aside } from "./components/ui/aside";
import Disclosure from "./components/Disclosure.astro";
import DocsLanding from "./components/DocsLanding.astro";
import Render from "./components/Render.astro";
import TurnSpine from "./components/TurnSpine.astro";
import { Card } from "./components/ui/card";
import { CardGrid } from "./components/ui/card-grid";
import { PackageManagers } from "./components/ui/package-managers";
import { Step, Steps } from "./components/ui/steps";
import { Tabs, TabItem } from "./components/ui/tabs";

export const components = {
  Aside,
  Card,
  CardGrid,
  Disclosure,
  DocsLanding,
  PackageManagers,
  Render,
  Step,
  Steps,
  TabItem,
  Tabs,
  TurnSpine,
};
