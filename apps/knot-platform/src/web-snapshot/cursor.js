export function encodeCursor(createdAt, id) {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor) {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    return { createdAt: new Date(iso), id };
  } catch {
    return null;
  }
}
