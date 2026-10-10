import { h } from "vue";

function knotIcon(children) {
  return (props, { attrs }) =>
    h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: "1em",
        height: "1em",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.75,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": attrs["aria-hidden"] !== false,
        ...attrs,
        class: attrs.class,
      },
      children
    );
}

export const HomeIcon = knotIcon([h("path", { d: "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" })]);
export const PlazaIcon = knotIcon([
  h("rect", { x: 3, y: 3, width: 7, height: 7, rx: 1 }),
  h("rect", { x: 14, y: 3, width: 7, height: 7, rx: 1 }),
  h("rect", { x: 3, y: 14, width: 7, height: 7, rx: 1 }),
  h("rect", { x: 14, y: 14, width: 7, height: 7, rx: 1 }),
]);
export const UserIcon = knotIcon([
  h("circle", { cx: 12, cy: 8, r: 3.5 }),
  h("path", { d: "M5 19c0-3.5 3-6 7-6s7 2.5 7 6" }),
]);
export const AgentIcon = knotIcon([
  h("rect", { x: 5, y: 8, width: 14, height: 10, rx: 2 }),
  h("path", { d: "M9 8V6a3 3 0 0 1 6 0v2" }),
  h("circle", { cx: 10, cy: 13, r: 1, fill: "currentColor", stroke: "none" }),
  h("circle", { cx: 14, cy: 13, r: 1, fill: "currentColor", stroke: "none" }),
]);
export const LogInIcon = knotIcon([
  h("path", { d: "M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" }),
  h("path", { d: "M13 12 20 12M20 12 17 9M20 12 17 15" }),
]);
export const LogOutIcon = knotIcon([
  h("path", { d: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" }),
  h("path", { d: "M11 12 4 12M4 12 7 9M4 12 7 15" }),
]);
export const SearchIcon = knotIcon([
  h("circle", { cx: 11, cy: 11, r: 5.5 }),
  h("path", { d: "M16 16 20 20" }),
]);
export const ExchangeIcon = knotIcon([h("path", { d: "M7 7h11l-2.5-2.5M18 17H7l2.5 2.5" })]);
export const RefreshIcon = knotIcon([
  h("path", { d: "M20 12a8 8 0 1 1-2.1-5.4" }),
  h("path", { d: "M20 4v5h-5" }),
]);
export const UploadIcon = knotIcon([
  h("path", { d: "M12 16V6M12 6l3.5 3.5M12 6 8.5 9.5" }),
  h("path", { d: "M5 18h14" }),
]);
export const StackIcon = knotIcon([
  h("path", { d: "M6 9 12 6l6 3-6 3-6-3Z" }),
  h("path", { d: "M6 13l6 3 6-3" }),
  h("path", { d: "M6 17l6 3 6-3" }),
]);
export const CpuIcon = knotIcon([
  h("rect", { x: 7, y: 7, width: 10, height: 10, rx: 1.5 }),
  h("path", { d: "M7 10H4M7 14H4M20 10h-3M20 14h-3M10 7V4M14 7V4M10 20v-3M14 20v-3" }),
]);
