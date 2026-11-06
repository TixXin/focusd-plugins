// GitHub REST calls and size-limited downloads. GITHUB_TOKEN (set in Actions)
// raises the API rate limit; without it the public limit applies.

const API = "https://api.github.com";
const USER_AGENT = "focusd-plugins-index";

function headers(extra = {}) {
  const token = process.env.GITHUB_TOKEN;
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/** GET (or another method) on the REST API. Returns { status, body }; body is parsed JSON or null. */
export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: headers(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

/** Downloads `url` into a Buffer, refusing anything larger than `limit` bytes. */
export async function download(url, limit) {
  if (!url.startsWith("https://")) throw new Error(`${url} is not an https:// address.`);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error(`${url} is ${declared} bytes; the market takes at most ${limit}.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`${url} is larger than ${limit} bytes; the market takes at most ${limit}.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The text at `url`, or null when it answers 404; anything larger than `limit` bytes is refused. */
export async function downloadTextIfPresent(url, limit) {
  try {
    return (await download(url, limit)).toString("utf8");
  } catch (error) {
    if (/ answered 404\.$/.test(error.message)) return null;
    throw error;
  }
}

/** The releases of `repo` ("owner/name"), newest first (one page of 50 is plenty for picking the latest). */
export async function listReleases(repo) {
  const { status, body } = await api(`/repos/${repo}/releases?per_page=50`);
  if (status === 404) throw new Error(`The repository ${repo} does not exist or is private.`);
  if (status !== 200 || !Array.isArray(body)) throw new Error(`Listing the releases of ${repo} failed (${status}).`);
  return body;
}
