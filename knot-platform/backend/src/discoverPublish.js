let publish = () => {};

export function setDiscoverPublisher(fn) {
  publish = typeof fn === "function" ? fn : () => {};
}

export function touchDiscoverBoard() {
  publish();
}
