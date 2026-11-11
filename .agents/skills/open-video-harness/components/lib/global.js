// For a page of classic scripts (canvas-film's film.html): the library as window.OVH, so OVH.grain(X, t, {…}) works from
// any script once modules have run (before window.film's ready resolves). <script type="module" src="components/lib/global.js">
import * as lib from "./index.js";
window.OVH = lib;
