import { h } from "vue";

const STROKE = 1.75;
const HEADER_STROKE = 2.35;

function iconAttrs(props, attrs) {
  const filled = props.filled === true || props.filled === "";
  const rest = { ...attrs };
  delete rest.filled;
  delete rest.weight;
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    width: "1em",
    height: "1em",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": rest["aria-hidden"] !== false,
    ...rest,
    class: rest.class,
    fill: filled ? "currentColor" : "none",
    stroke: filled ? "none" : "currentColor",
    "stroke-width": props.weight === "header" ? HEADER_STROKE : STROKE,
  };
}

function knotIcon(children) {
  return (props, { attrs }) => h("svg", iconAttrs(props, attrs), children);
}

export const LanguageIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("path", { d: "M4 12h16" }),
  h("path", { d: "M12 4c2.2 2.4 3.3 5.1 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5.1-3.3-8s1.1-5.6 3.3-8Z" }),
]);
export const UserIcon = knotIcon([
  h("circle", { cx: 12, cy: 8, r: 3.5 }),
  h("path", { d: "M5 19c0-3.5 3-6 7-6s7 2.5 7 6" }),
]);
export const AtIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 3.25 }),
  h("path", { d: "M15.2 12.2v1.2a2 2 0 0 0 4 0V12a7.2 7.2 0 1 0-2.7 5.7" }),
]);
export const FriendsIcon = knotIcon([
  h("circle", { cx: 9, cy: 8, r: 3 }),
  h("path", { d: "M3.5 18.5c.4-2.7 2.5-4.5 5.5-4.5s5.1 1.8 5.5 4.5" }),
  h("circle", { cx: 17, cy: 9.2, r: 2.3 }),
  h("path", { d: "M15.6 14.4c1.5.35 2.7 1.5 3.1 3.1" }),
]);
export const FriendAddIcon = knotIcon([
  h("circle", { cx: 9.5, cy: 8, r: 3 }),
  h("path", { d: "M3.8 18.5c.4-2.8 2.6-4.6 5.7-4.6 1.1 0 2.1.3 3 .8" }),
  h("path", { d: "M17 10.5v6M14 13.5h6" }),
]);
export const FriendRemoveIcon = knotIcon([
  h("circle", { cx: 9.5, cy: 8, r: 3 }),
  h("path", { d: "M3.8 18.5c.4-2.8 2.6-4.6 5.7-4.6 1.1 0 2.1.3 3 .8" }),
  h("path", { d: "M14 13.5h6" }),
]);
export const FriendCheckIcon = knotIcon([
  h("circle", { cx: 9.5, cy: 8, r: 3 }),
  h("path", { d: "M3.8 18.5c.4-2.8 2.6-4.6 5.7-4.6 1.1 0 2.1.3 3 .8" }),
  h("path", { d: "m14 13.5 2 2 4-4" }),
]);
export const ChatIcon = knotIcon([
  h("path", { d: "M5 6h14a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" }),
]);
export const BellIcon = knotIcon([
  h("path", { d: "M12 4.4v1.4" }),
  h("path", { d: "M8.2 10.4a3.8 3.8 0 0 1 7.6 0c0 2.8.7 4.2 1.5 5H6.7c.8-.8 1.5-2.2 1.5-5Z" }),
  h("path", { d: "M10.1 16.8a1.9 1.9 0 0 0 3.8 0" }),
]);
export const BackIcon = knotIcon([
  h("path", { d: "M15 5 8 12l7 7" }),
]);
export const ChevronDownIcon = knotIcon([
  h("path", { d: "m6 9 6 6 6-6" }),
]);
export const CheckIcon = knotIcon([
  h("path", { d: "M5 12.5 10 17.5 19 7" }),
]);
export const PlusIcon = knotIcon([
  h("path", { d: "M12 6v12M6 12h12" }),
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
export const ImageIcon = knotIcon([
  h("rect", { x: 4, y: 5, width: 16, height: 14, rx: 2 }),
  h("circle", { cx: 9, cy: 10, r: 1.5 }),
  h("path", { d: "m4.5 15.5 4.2-3.4 3.6 3 2.2-1.8 5 3.7" }),
]);
export const VideoIcon = knotIcon([
  h("rect", { x: 3.5, y: 6, width: 17, height: 12, rx: 2 }),
  h("path", { d: "m10 9.5 5 2.5-5 2.5V9.5Z" }),
]);
export const AudioIcon = knotIcon([
  h("path", { d: "M4 10v4h3l4 3V7L7 10H4Z" }),
  h("path", { d: "M16 9.5a3.5 3.5 0 0 1 0 5" }),
  h("path", { d: "M18.5 7a7 7 0 0 1 0 10" }),
]);
export const SendIcon = knotIcon([
  h("path", { d: "M5 12h12M12 6l6 6-6 6" }),
]);
export const RespondIcon = knotIcon([
  h("path", { d: "M19 15.75A6.75 6.75 0 0 0 12.25 9H7.5" }),
  h("path", { d: "M11 5.25 7 9l4 3.75" }),
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
export const LikeIcon = knotIcon([
  h("path", { d: "M8 10.5v8.2a1 1 0 0 1-1 1H5.6A1.6 1.6 0 0 1 4 18.1v-6a1.6 1.6 0 0 1 1.6-1.6H8Z" }),
  h("path", { d: "M8 10.6 11.2 4.8a1.7 1.7 0 0 1 3.1 1.1V9.2h4.2a1.8 1.8 0 0 1 1.8 2.1l-1.1 6.4a1.8 1.8 0 0 1-1.8 1.5H8" }),
]);
export const StarIcon = knotIcon([
  h("path", { d: "M12 3.2 14.2 8.7l5.9.5-4.5 3.9 1.4 5.7L12 16.2 7 18.8l1.4-5.7L3.9 9.2l5.9-.5Z" }),
]);
export const DownloadIcon = knotIcon([
  h("path", { d: "M12 4v10" }),
  h("path", { d: "m8 10 4 4 4-4" }),
  h("path", { d: "M5 19h14" }),
]);
export const ShareIcon = knotIcon([
  h("path", { d: "M12 16V5" }),
  h("path", { d: "m8 8 4-4 4 4" }),
  h("path", { d: "M6 12.5V18a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5.5" }),
]);
export const ClockIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("path", { d: "M12 8v4.5l2.5 1.5" }),
]);
export const CoinIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("circle", { cx: 12, cy: 12, r: 5.1 }),
  h("path", { d: "M12 8.6v6.8" }),
]);
export const PassedIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("path", { d: "M8.4 12.2 11 14.8 15.8 9.6" }),
]);
export const RejectedIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("path", { d: "M9.2 9.2 14.8 14.8M14.8 9.2 9.2 14.8" }),
]);
export const RemovedIcon = knotIcon([
  h("circle", { cx: 12, cy: 12, r: 8 }),
  h("path", { d: "M7.4 16.6 16.6 7.4" }),
]);
export const AlertIcon = knotIcon([
  h("path", { d: "M12 4.2 20.2 19.2H3.8Z" }),
  h("path", { d: "M12 10v4" }),
  h("circle", { cx: 12, cy: 16.7, r: 0.6, fill: "currentColor", stroke: "none" }),
]);
export const PencilIcon = knotIcon([
  h("path", { d: "M4 20h3.2L17.6 9.6a2.2 2.2 0 0 0-3.2-3.2L4 16.8V20Z" }),
  h("path", { d: "m12.8 6.8 3.4 3.4" }),
]);
export const AgentIcon = knotIcon([
  h("path", { d: "M12 7.2V4.6" }),
  h("circle", { cx: 12, cy: 3.8, r: 0.85, fill: "currentColor", stroke: "none" }),
  h("rect", { x: 5.5, y: 7.2, width: 13, height: 10.2, rx: 2.6 }),
  h("circle", { cx: 9.6, cy: 11.6, r: 0.85, fill: "currentColor", stroke: "none" }),
  h("circle", { cx: 14.4, cy: 11.6, r: 0.85, fill: "currentColor", stroke: "none" }),
  h("path", { d: "M9.5 14.6h5" }),
  h("path", { d: "M5.5 12H3.6M20.4 12H18.5" }),
]);
export const PlatformIcon = knotIcon([
  h("path", { d: "M4 20.2h16" }),
  h("path", { d: "M6.2 20.2V9.4L12 5.2l5.8 4.2v10.8" }),
  h("path", { d: "M10.2 20.2v-4.4h3.6v4.4" }),
  h("path", { d: "M9 11.4h1.7M13.3 11.4H15M9 14.6h1.7M13.3 14.6H15" }),
]);
export const QuoteIcon = knotIcon([
  h("path", { d: "M10.5 12.5H6.6a2 2 0 0 1-2-2V8.6a2 2 0 0 1 2-2h1.9a2 2 0 0 1 2 2v6a4.4 4.4 0 0 1-4.4 4.4" }),
  h("path", { d: "M20.5 12.5h-3.9a2 2 0 0 1-2-2V8.6a2 2 0 0 1 2-2h1.9a2 2 0 0 1 2 2v6a4.4 4.4 0 0 1-4.4 4.4" }),
]);
export const CopyIcon = knotIcon([
  h("rect", { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
  h("path", { d: "M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" }),
]);
