const SESSION_COOKIE = "g_session";
const SESSION_DAYS = 30;
const GRAVITY = 1.8;
const TOP_LIMIT = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: String(err && err.message || err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  const session = await getSession(request, env);
  const user = session
    ? await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(session.user_id).first()
    : null;

  if (path === "/api/me" && method === "GET") {
    return json({ user });
  }

  if (path === "/api/register" && method === "POST") {
    return register(env, await request.json());
  }

  if (path === "/api/login" && method === "POST") {
    return login(env, await request.json());
  }

  if (path === "/api/logout" && method === "POST") {
    if (session) {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(session.token).run();
    }
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearCookie() } });
  }

  if (path === "/api/stories" && method === "GET") {
    return listStories(env, url.searchParams.get("sort") || "top", user);
  }

  if (path === "/api/stories" && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return submitStory(env, user, await request.json());
  }

  const storyMatch = path.match(/^\/api\/stories\/(\d+)$/);
  if (storyMatch && method === "GET") {
    return getStory(env, parseInt(storyMatch[1]), user);
  }

  const voteMatch = path.match(/^\/api\/stories\/(\d+)\/vote$/);
  if (voteMatch && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return vote(env, parseInt(voteMatch[1]), user);
  }

  const commentsMatch = path.match(/^\/api\/stories\/(\d+)\/comments$/);
  if (commentsMatch && method === "GET") {
    return listComments(env, parseInt(commentsMatch[1]));
  }

  if (path === "/api/comments" && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return submitComment(env, user, await request.json());
  }

  return json({ error: "not found" }, 404);
}

// --- auth ---

async function register(env, body) {
  let { username, password } = body || {};
  if (!username || !password) return json({ error: "username and password required" }, 400);
  username = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,20}$/.test(username)) {
    return json({ error: "username must be 2-20 chars: a-z 0-9 _ -" }, 400);
  }
  if (String(password).length < 8) {
    return json({ error: "password must be at least 8 characters" }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return json({ error: "username taken" }, 409);

  const salt = randomHex(16);
  const hash = await pbkdf2(password, salt);
  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)"
  ).bind(username, hash, salt).run();
  const userId = result.meta.last_row_id;
  const cookie = await createSession(env, userId);
  return json({ user: { id: userId, username } }, 200, { "Set-Cookie": cookie });
}

async function login(env, body) {
  let { username, password } = body || {};
  if (!username || !password) return json({ error: "username and password required" }, 400);
  username = String(username).trim().toLowerCase();
  const u = await env.DB.prepare(
    "SELECT id, username, password_hash, password_salt FROM users WHERE username = ?"
  ).bind(username).first();
  if (!u) return json({ error: "invalid credentials" }, 401);
  const hash = await pbkdf2(password, u.password_salt);
  if (!timingSafeEqual(hash, u.password_hash)) return json({ error: "invalid credentials" }, 401);
  const cookie = await createSession(env, u.id);
  return json({ user: { id: u.id, username: u.username } }, 200, { "Set-Cookie": cookie });
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(token, userId, expiresAt).run();
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function getSession(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT token, user_id, expires_at FROM sessions WHERE token = ?"
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return row;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

// --- stories ---

async function listStories(env, sort, user) {
  const orderBy = sort === "new"
    ? "s.created_at DESC, s.id DESC"
    : "score DESC, s.created_at DESC";
  const userId = user ? user.id : -1;
  const stmt = env.DB.prepare(`
    SELECT s.id, s.title, s.url, s.text, s.created_at, u.username,
      COUNT(v.user_id) AS points,
      (CAST(COUNT(v.user_id) AS REAL) - 1.0) /
        POW(((unixepoch() - unixepoch(s.created_at)) / 3600.0) + 2.0, ?) AS score,
      EXISTS(SELECT 1 FROM votes WHERE story_id = s.id AND user_id = ?) AS voted,
      (SELECT COUNT(*) FROM comments WHERE story_id = s.id) AS comment_count
    FROM stories s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN votes v ON v.story_id = s.id
    GROUP BY s.id
    ORDER BY ${orderBy}
    LIMIT ?
  `);
  const result = await stmt.bind(GRAVITY, userId, TOP_LIMIT).all();
  return json({ stories: (result.results || []).map(formatStory) });
}

async function getStory(env, storyId, user) {
  const userId = user ? user.id : -1;
  const row = await env.DB.prepare(`
    SELECT s.id, s.title, s.url, s.text, s.created_at, u.username,
      (SELECT COUNT(*) FROM votes WHERE story_id = s.id) AS points,
      EXISTS(SELECT 1 FROM votes WHERE story_id = s.id AND user_id = ?) AS voted,
      (SELECT COUNT(*) FROM comments WHERE story_id = s.id) AS comment_count
    FROM stories s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).bind(userId, storyId).first();
  if (!row) return json({ error: "story not found" }, 404);
  return json({ story: formatStory(row) });
}

function formatStory(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    text: row.text,
    user: row.username,
    age: ageString(row.created_at),
    points: row.points,
    voted: Boolean(row.voted),
    comments: row.comment_count,
  };
}

function ageString(sqliteDatetime) {
  const isoUtc = sqliteDatetime.replace(" ", "T") + "Z";
  const created = new Date(isoUtc).getTime();
  const diffMs = Date.now() - created;
  const min = Math.max(0, Math.floor(diffMs / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(isoUtc).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function submitStory(env, user, body) {
  let { title, url: storyUrl, text } = body || {};
  title = (title || "").trim();
  storyUrl = (storyUrl || "").trim() || null;
  text = (text || "").trim() || null;
  if (!title) return json({ error: "title required" }, 400);
  if (title.length > 200) return json({ error: "title must be under 200 characters" }, 400);
  if (storyUrl && !/^https?:\/\//i.test(storyUrl)) return json({ error: "url must start with http:// or https://" }, 400);
  if (!storyUrl && !text) return json({ error: "url or text required" }, 400);
  if (text && text.length > 10000) return json({ error: "text too long" }, 400);

  const result = await env.DB.prepare(
    "INSERT INTO stories (user_id, title, url, text) VALUES (?, ?, ?, ?)"
  ).bind(user.id, title, storyUrl, text).run();
  const storyId = result.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO votes (user_id, story_id) VALUES (?, ?)"
  ).bind(user.id, storyId).run();
  return json({ id: storyId }, 201);
}

async function vote(env, storyId, user) {
  const exists = await env.DB.prepare("SELECT 1 FROM stories WHERE id = ?").bind(storyId).first();
  if (!exists) return json({ error: "story not found" }, 404);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO votes (user_id, story_id) VALUES (?, ?)"
  ).bind(user.id, storyId).run();
  const points = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM votes WHERE story_id = ?"
  ).bind(storyId).first();
  return json({ voted: true, points: points.c });
}

// --- comments ---

async function listComments(env, storyId) {
  const result = await env.DB.prepare(`
    SELECT c.id, c.parent_id, c.text, c.created_at, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.story_id = ?
    ORDER BY c.created_at ASC
  `).bind(storyId).all();
  const rows = (result.results || []).map(r => ({
    id: r.id,
    parent_id: r.parent_id,
    text: r.text,
    user: r.username,
    age: ageString(r.created_at),
    replies: [],
  }));
  const byId = new Map(rows.map(r => [r.id, r]));
  const roots = [];
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id).replies.push(r);
    } else {
      roots.push(r);
    }
  }
  return json({ comments: roots });
}

async function submitComment(env, user, body) {
  let { story_id, parent_id, text } = body || {};
  text = (text || "").trim();
  if (!text) return json({ error: "comment text required" }, 400);
  if (text.length > 5000) return json({ error: "comment too long" }, 400);
  const storyId = parseInt(story_id);
  if (!storyId) return json({ error: "story_id required" }, 400);
  const parentId = parent_id ? parseInt(parent_id) : null;

  const story = await env.DB.prepare("SELECT id FROM stories WHERE id = ?").bind(storyId).first();
  if (!story) return json({ error: "story not found" }, 404);
  if (parentId) {
    const p = await env.DB.prepare(
      "SELECT id FROM comments WHERE id = ? AND story_id = ?"
    ).bind(parentId, storyId).first();
    if (!p) return json({ error: "parent comment not found" }, 404);
  }

  const result = await env.DB.prepare(
    "INSERT INTO comments (story_id, parent_id, user_id, text) VALUES (?, ?, ?, ?)"
  ).bind(storyId, parentId, user.id, text).run();
  return json({ id: result.meta.last_row_id }, 201);
}

// --- crypto helpers ---

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function pbkdf2(password, saltHex) {
  const enc = new TextEncoder();
  const salt = hexToBytes(saltHex);
  const km = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    km, 256
  );
  return bytesToHex(new Uint8Array(bits));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
