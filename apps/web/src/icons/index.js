import { h } from "vue";

function knotIcon(children, options = {}) {
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
        strokeWidth: options.strokeWidth ?? 1.75,
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
export const BookmarkIcon = knotIcon([
  h("path", { d: "M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.5L6 20V5.5a1 1 0 0 1 1-1Z" }),
]);
export const ActivityIcon = knotIcon([
  h("path", { d: "M4 15.5 8.5 11l3 3L20 6.5" }),
  h("path", { d: "M14.5 6.5H20V12" }),
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
export const CloseIcon = knotIcon([
  h("path", { d: "M7 7 17 17M17 7 7 17" }),
]);
export const RefreshIcon = knotIcon([
  h("path", { d: "M20 12a8 8 0 0 0-8-8 8.7 8.7 0 0 0-6 2.5L4 8" }),
  h("path", { d: "M4 4v4h4" }),
  h("path", { d: "M4 12a8 8 0 0 0 8 8 8.7 8.7 0 0 0 6-2.5L20 16" }),
  h("path", { d: "M16 16h4v4" }),
]);
export const StarIcon = (props, { attrs }) => {
  const filled = props.filled === true || props.filled === "";
  const rest = { ...attrs };
  delete rest.filled;
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      width: "1em",
      height: "1em",
      fill: filled ? "currentColor" : "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinejoin: "round",
      "aria-hidden": rest["aria-hidden"] !== false,
      ...rest,
      class: rest.class,
    },
    [
      h("path", {
        d: "M12 3.2 14.2 8.7l5.9.5-4.5 3.9 1.4 5.7L12 16.2 7 18.8l1.4-5.7L3.9 9.2l5.9-.5Z",
      }),
    ]
  );
};
export const PointsIcon = knotIcon([
  h("path", {
    d: "M12 2.95 14.41 9.64 21.51 9.86 15.9 14.22 17.88 21.05 12 17.05 6.12 21.05 8.1 14.22 2.49 9.86 9.59 9.64Z",
    fill: "currentColor",
    stroke: "none",
  }),
]);
export const ClaimedIcon = knotIcon(
  [
    h("circle", { cx: 12, cy: 12, r: 9 }),
    h("path", { d: "M8.15 12.2 11.05 15.15 16.2 9.4" }),
  ],
  { strokeWidth: 2 }
);
export const ReadyIcon = knotIcon(
  [
    h("path", { d: "M12 19.6V7.2" }),
    h("path", { d: "M7.7 11.2 12 6.4 16.3 11.2" }),
  ],
  { strokeWidth: 2 }
);
export const SubmittedIcon = knotIcon(
  [
    h("circle", { cx: 12, cy: 12, r: 9 }),
    h("path", { d: "M12 7.6V12.2l3.1 1.9" }),
  ],
  { strokeWidth: 2 }
);
export const StopIcon = knotIcon([
  h("rect", { x: 6, y: 6, width: 12, height: 12, rx: 2 }),
]);
export const EditIcon = knotIcon([
  h("path", { d: "M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1L16.6 5.5a1.5 1.5 0 0 0-2.1 0L4 16v4Z" }),
  h("path", { d: "M13.5 6.5 17.5 10.5" }),
]);
export const DownloadIcon = knotIcon([
  h("path", { d: "M12 4v10" }),
  h("path", { d: "m8 10 4 4 4-4" }),
  h("path", { d: "M5 19h14" }),
]);
export const ClockIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("path", { d: "M12 8v4.5l2.5 1.5" }),
]);