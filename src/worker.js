const SESSION_COOKIE = "g_session";
const SESSION_DAYS = 30;
const GRAVITY = 1.8;
const TOP_LIMIT = 30;
const MAX_LIMIT = 60;
const EDIT_WINDOW_SECONDS = 1800;

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

  if (path === "/api/me" && method === "GET") return json({ user });

  if (path === "/api/me/password" && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return changePassword(env, user, await request.json());
  }

  if (path === "/api/register" && method === "POST") return register(env, await request.json());
  if (path === "/api/login" && method === "POST") return login(env, await request.json());

  if (path === "/api/logout" && method === "POST") {
    if (session) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(session.token).run();
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearCookie() } });
  }

  const userMatch = path.match(/^\/api\/users\/([a-z0-9_-]+)$/i);
  if (userMatch && method === "GET") return getUserProfile(env, userMatch[1]);

  if (path === "/api/stories" && method === "GET") return listStories(env, url.searchParams, user);
  if (path === "/api/stories" && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return submitStory(env, user, await request.json());
  }

  const storyMatch = path.match(/^\/api\/stories\/(\d+)$/);
  if (storyMatch) {
    const storyId = parseInt(storyMatch[1]);
    if (method === "GET") return getStory(env, storyId, user);
    if (method === "PATCH") {
      if (!user) return json({ error: "login required" }, 401);
      return editStory(env, user, storyId, await request.json());
    }
    if (method === "DELETE") {
      if (!user) return json({ error: "login required" }, 401);
      return deleteStory(env, user, storyId);
    }
  }

  const voteMatch = path.match(/^\/api\/stories\/(\d+)\/vote$/);
  if (voteMatch && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return vote(env, parseInt(voteMatch[1]), user);
  }

  const commentsListMatch = path.match(/^\/api\/stories\/(\d+)\/comments$/);
  if (commentsListMatch && method === "GET") return listComments(env, parseInt(commentsListMatch[1]), user);

  if (path === "/api/comments" && method === "POST") {
    if (!user) return json({ error: "login required" }, 401);
    return submitComment(env, user, await request.json());
  }

  const commentMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentMatch) {
    const commentId = parseInt(commentMatch[1]);
    if (method === "PATCH") {
      if (!user) return json({ error: "login required" }, 401);
      return editComment(env, user, commentId, await request.json());
    }
    if (method === "DELETE") {
      if (!user) return json({ error: "login required" }, 401);
      return deleteComment(env, user, commentId);
    }
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
  if (String(password).length < 8) return json({ error: "password must be at least 8 characters" }, 400);
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

async function changePassword(env, user, body) {
  const { current, next } = body || {};
  if (!current || !next) return json({ error: "current and new password required" }, 400);
  if (String(next).length < 8) return json({ error: "new password must be at least 8 characters" }, 400);
  const row = await env.DB.prepare(
    "SELECT password_hash, password_salt FROM users WHERE id = ?"
  ).bind(user.id).first();
  const currHash = await pbkdf2(current, row.password_salt);
  if (!timingSafeEqual(currHash, row.password_hash)) return json({ error: "current password is wrong" }, 401);
  const newSalt = randomHex(16);
  const newHash = await pbkdf2(next, newSalt);
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
  ).bind(newHash, newSalt, user.id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  const cookie = await createSession(env, user.id);
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
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

// --- users ---

async function getUserProfile(env, username) {
  username = String(username).toLowerCase();
  const u = await env.DB.prepare(
    "SELECT id, username, created_at FROM users WHERE username = ?"
  ).bind(username).first();
  if (!u) return json({ error: "user not found" }, 404);

  const k = await env.DB.prepare(`
    SELECT COUNT(*) AS karma FROM votes v
    JOIN stories s ON s.id = v.story_id
    WHERE s.user_id = ? AND v.user_id != s.user_id
  `).bind(u.id).first();

  const submissions = await env.DB.prepare(`
    SELECT s.id, s.title, s.url, s.created_at,
      (SELECT COUNT(*) FROM votes WHERE story_id = s.id) AS points,
      (SELECT COUNT(*) FROM comments WHERE story_id = s.id) AS comment_count
    FROM stories s WHERE s.user_id = ?
    ORDER BY s.created_at DESC LIMIT 20
  `).bind(u.id).all();

  const comments = await env.DB.prepare(`
    SELECT c.id, c.story_id, c.text, c.created_at, s.title AS story_title
    FROM comments c JOIN stories s ON s.id = c.story_id
    WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 20
  `).bind(u.id).all();

  return json({
    profile: {
      username: u.username,
      created: ageString(u.created_at),
      karma: k.karma,
      submissions: (submissions.results || []).map(s => ({
        id: s.id, title: s.title, url: s.url,
        points: s.points, comments: s.comment_count,
        age: ageString(s.created_at),
      })),
      comments: (comments.results || []).map(c => ({
        id: c.id, story_id: c.story_id, story_title: c.story_title,
        text: c.text, age: ageString(c.created_at),
      })),
    },
  });
}

// --- stories ---

async function listStories(env, searchParams, user) {
  const sort = searchParams.get("sort") || "top";
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") || String(TOP_LIMIT))));
  const userId = user ? user.id : -1;

  let where = "";
  let orderBy;
  if (sort === "new") {
    orderBy = "s.created_at DESC, s.id DESC";
  } else if (sort === "ask") {
    where = "WHERE LOWER(s.title) LIKE 'ask g:%' OR LOWER(s.title) LIKE 'ask hn:%' OR (s.url IS NULL AND LOWER(s.title) LIKE 'ask%')";
    orderBy = "score DESC, s.created_at DESC";
  } else if (sort === "show") {
    where = "WHERE LOWER(s.title) LIKE 'show g:%' OR LOWER(s.title) LIKE 'show hn:%'";
    orderBy = "score DESC, s.created_at DESC";
  } else {
    orderBy = "score DESC, s.created_at DESC";
  }

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
    ${where}
    GROUP BY s.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `);
  const result = await stmt.bind(GRAVITY, userId, limit, offset).all();
  const stories = (result.results || []).map(formatStory);
  return json({ stories, has_more: stories.length === limit, offset, limit });
}

async function getStory(env, storyId, user) {
  const userId = user ? user.id : -1;
  const row = await env.DB.prepare(`
    SELECT s.id, s.user_id, s.title, s.url, s.text, s.created_at, u.username,
      (SELECT COUNT(*) FROM votes WHERE story_id = s.id) AS points,
      EXISTS(SELECT 1 FROM votes WHERE story_id = s.id AND user_id = ?) AS voted,
      (SELECT COUNT(*) FROM comments WHERE story_id = s.id) AS comment_count
    FROM stories s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).bind(userId, storyId).first();
  if (!row) return json({ error: "story not found" }, 404);
  const story = formatStory(row);
  story.own = !!(user && user.id === row.user_id);
  story.editable = story.own && withinEditWindow(row.created_at);
  return json({ story });
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

function withinEditWindow(sqliteDatetime) {
  const isoUtc = sqliteDatetime.replace(" ", "T") + "Z";
  const created = new Date(isoUtc).getTime();
  return (Date.now() - created) < EDIT_WINDOW_SECONDS * 1000;
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

async function editStory(env, user, storyId, body) {
  const story = await env.DB.prepare(
    "SELECT user_id, created_at FROM stories WHERE id = ?"
  ).bind(storyId).first();
  if (!story) return json({ error: "story not found" }, 404);
  if (story.user_id !== user.id) return json({ error: "not your story" }, 403);
  if (!withinEditWindow(story.created_at)) return json({ error: "edit window has passed" }, 403);

  let { title, url: storyUrl, text } = body || {};
  title = (title || "").trim();
  storyUrl = (storyUrl || "").trim() || null;
  text = (text || "").trim() || null;
  if (!title) return json({ error: "title required" }, 400);
  if (title.length > 200) return json({ error: "title must be under 200 characters" }, 400);
  if (storyUrl && !/^https?:\/\//i.test(storyUrl)) return json({ error: "url must start with http:// or https://" }, 400);
  if (!storyUrl && !text) return json({ error: "url or text required" }, 400);
  if (text && text.length > 10000) return json({ error: "text too long" }, 400);

  await env.DB.prepare(
    "UPDATE stories SET title = ?, url = ?, text = ? WHERE id = ?"
  ).bind(title, storyUrl, text, storyId).run();
  return json({ id: storyId });
}

async function deleteStory(env, user, storyId) {
  const story = await env.DB.prepare(
    "SELECT user_id, created_at FROM stories WHERE id = ?"
  ).bind(storyId).first();
  if (!story) return json({ error: "story not found" }, 404);
  if (story.user_id !== user.id) return json({ error: "not your story" }, 403);
  if (!withinEditWindow(story.created_at)) return json({ error: "edit window has passed" }, 403);
  await env.DB.prepare("DELETE FROM stories WHERE id = ?").bind(storyId).run();
  return json({ ok: true });
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

async function listComments(env, storyId, user) {
  const result = await env.DB.prepare(`
    SELECT c.id, c.parent_id, c.user_id, c.text, c.created_at, u.username
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.story_id = ?
    ORDER BY c.created_at ASC
  `).bind(storyId).all();
  const userId = user ? user.id : -1;
  const rows = (result.results || []).map(r => ({
    id: r.id,
    parent_id: r.parent_id,
    text: r.text,
    user: r.username,
    age: ageString(r.created_at),
    own: r.user_id === userId,
    editable: r.user_id === userId && withinEditWindow(r.created_at),
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

async function editComment(env, user, commentId, body) {
  const comment = await env.DB.prepare(
    "SELECT user_id, created_at FROM comments WHERE id = ?"
  ).bind(commentId).first();
  if (!comment) return json({ error: "comment not found" }, 404);
  if (comment.user_id !== user.id) return json({ error: "not your comment" }, 403);
  if (!withinEditWindow(comment.created_at)) return json({ error: "edit window has passed" }, 403);

  let { text } = body || {};
  text = (text || "").trim();
  if (!text) return json({ error: "comment text required" }, 400);
  if (text.length > 5000) return json({ error: "comment too long" }, 400);
  await env.DB.prepare("UPDATE comments SET text = ? WHERE id = ?").bind(text, commentId).run();
  return json({ id: commentId });
}

async function deleteComment(env, user, commentId) {
  const comment = await env.DB.prepare(
    "SELECT user_id, created_at FROM comments WHERE id = ?"
  ).bind(commentId).first();
  if (!comment) return json({ error: "comment not found" }, 404);
  if (comment.user_id !== user.id) return json({ error: "not your comment" }, 403);
  if (!withinEditWindow(comment.created_at)) return json({ error: "edit window has passed" }, 403);
  // Soft delete preserves the thread shape
  await env.DB.prepare("UPDATE comments SET text = '[deleted]' WHERE id = ?").bind(commentId).run();
  return json({ ok: true });
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
