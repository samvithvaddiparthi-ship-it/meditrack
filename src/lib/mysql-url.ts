/**
 * Authentication options for the MariaDB/MySQL Node driver, derived from a
 * mysql:// connection URL.
 *
 * MySQL 8 authenticates with `caching_sha2_password`. On the first login
 * after a server restart (before the password is cached) the password must
 * travel over TLS or be encrypted with the server's RSA public key, which the
 * driver will only fetch from the server when `allowPublicKeyRetrieval` is
 * on. Fetching the key is safe on the loopback interface (no network to
 * intercept), so it is enabled automatically for localhost. For a remote
 * server, use TLS, or opt in explicitly with `?allowPublicKeyRetrieval=true`.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function mysqlAuthOptions(url: URL): { allowPublicKeyRetrieval: boolean } {
  const explicit = url.searchParams.get("allowPublicKeyRetrieval");
  if (explicit !== null) return { allowPublicKeyRetrieval: explicit === "true" };
  return { allowPublicKeyRetrieval: LOOPBACK_HOSTS.has(url.hostname) };
}
