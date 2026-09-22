import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";

/** Server-side HTML for any component, for Bun.serve templates or static pages. */
export const toHtml = <P extends object>(component: ComponentType<P>, props: P): string => renderToStaticMarkup(createElement(component, props));
