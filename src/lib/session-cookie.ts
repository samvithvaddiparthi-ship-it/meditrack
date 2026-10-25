/** Session cookie name (shared by the proxy and the server session helpers). */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-meditrack_session" : "meditrack_session";
