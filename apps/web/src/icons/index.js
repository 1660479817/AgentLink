import { h } from "vue";

function knotIcon(children) {
  return (props, { attrs }) =>
    h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 24 24",
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

export const UserIcon = knotIcon([
  h("circle", { cx: 12, cy: 8, r: 3.5 }),
  h("path", { d: "M5 19c0-3.5 3-6 7-6s7 2.5 7 6" }),
]);
export const ChatIcon = knotIcon([
  h("path", { d: "M5 6h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" }),
]);
export const ZapIcon = knotIcon([
  h("path", {
    d: "M13 2.5 6.5 13.5H11l-1.5 8 7.5-11H13l1.5-8Z",
    fill: "currentColor",
    stroke: "none",
  }),
]);
export const BackIcon = knotIcon([
  h("path", { d: "M15 5 8 12l7 7" }),
]);
export const PlusIcon = knotIcon([
  h("path", { d: "M12 6v12M6 12h12" }),
]);
export const HistoryIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 7 }),
  h("path", { d: "M12 8v4.5L15 15" }),
]);
export const SearchIcon = knotIcon([
  h("circle", { cx: 11, cy: 11, r: 5.5 }),
  h("path", { d: "M16 16 20 20" }),
]);
export const PaperclipIcon = knotIcon([
  h("path", { d: "m8.5 12.5 6.2-6.2a2.6 2.6 0 0 1 3.7 3.7l-7.6 7.6a3.6 3.6 0 0 1-5.1-5.1l7-7" }),
]);
export const CameraIcon = knotIcon([
  h("path", { d: "M5 8h2.5l1.2-1.5H15l1.2 1.5H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" }),
  h("circle", { cx: 12, cy: 13, r: 3.25 }),
]);
export const ComposeIcon = knotIcon([
  h("path", { d: "M5 7h14M5 12h14M5 17h9" }),
]);
export const SendIcon = knotIcon([
  h("path", { d: "m5 12 14-7v14l-14-7Zm14-7-5.5 5.5" }),
]);