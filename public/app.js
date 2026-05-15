(function () {
  "use strict";

  let currentUser = null;

  const sp = new URLSearchParams(location.search);
  const VALID_SORTS = ["top", "new", "ask", "show"];
  const sort = VALID_SORTS.includes(sp.get("sort")) ? sp.get("sort") : "top";
  const page = Math.max(1, parseInt(sp.get("page") || "1"));
  const limit = 30;
  const offset = (page - 1) * limit;

  async function loadMe() {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      currentUser = data.user;
      renderAuth();
    } catch (e) { /* ignore */ }
  }

  function renderAuth() {
    const el = document.querySelector(".auth-nav");
    if (!el || !currentUser) return;
    const u = escapeHtml(currentUser.username);
    el.outerHTML =
      `<a href="/user.html?id=${encodeURIComponent(currentUser.username)}" class="user auth-nav">${u}</a>` +
      ` <span class="sep">|</span> ` +
      `<a href="/settings.html" class="auth-nav">settings</a>` +
      ` <span class="sep">|</span> ` +
      `<a href="#" class="logout auth-nav">logout</a>`;
    const lo = document.querySelector(".logout");
    if (lo) lo.addEventListener("click", async (e) => {
      e.preventDefault();
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      location.reload();
    });
  }

  function highlightSort() {
    document.querySelectorAll(".topnav .nav-sort").forEach(a => {
      a.classList.toggle("active", a.dataset.sort === sort);
    });
  }

  async function loadStories() {
    const ol = document.getElementById("story-list");
    if (!ol) return;
    ol.innerHTML = `<li class="loading"><em>Going to press&hellip;</em></li>`;
    try {
      const res = await fetch(`/api/stories?sort=${sort}&offset=${offset}&limit=${limit}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) {
        ol.innerHTML = `<li class="loading"><em>${escapeHtml(data.error || "Failed to load.")}</em></li>`;
        return;
      }
      renderStories(data.stories || [], data.has_more);
    } catch (e) {
      ol.innerHTML = `<li class="loading"><em>Failed to load the front page.</em></li>`;
    }
  }

  function renderStories(stories, hasMore) {
    const ol = document.getElementById("story-list");
    const moreEl = document.getElementById("more");
    if (!ol) return;
    if (stories.length === 0) {
      ol.innerHTML =
        `<li class="empty"><em>No stories yet. ` +
        `<a href="/submit.html">Be the first to file one.</a></em></li>`;
      if (moreEl) moreEl.innerHTML = "";
      return;
    }
    ol.innerHTML = stories.map((s, i) => storyHtml(s, offset + i + 1)).join("");
    ol.querySelectorAll(".upvote").forEach((el) => {
      el.addEventListener("click", () => onVote(el));
    });
    if (moreEl) {
      if (hasMore) {
        const next = page + 1;
        const params = new URLSearchParams();
        if (sort !== "top") params.set("sort", sort);
        params.set("page", String(next));
        moreEl.innerHTML = `<a href="/?${params.toString()}">More &rarr;</a>`;
      } else {
        moreEl.innerHTML = "";
      }
    }
  }

  function storyHtml(s, rank) {
    const url = s.url || `/comments.html?id=${s.id}`;
    const domain = s.url ? domainOf(s.url) : "";
    return `
      <li class="story" data-id="${s.id}">
        <span class="rank">${rank}.</span>
        <span class="upvote ${s.voted ? "voted" : ""}" data-id="${s.id}" title="upvote" aria-label="upvote">&#9650;</span>
        <div class="story-body">
          <span class="story-title">
            <a href="${escapeHtml(url)}">${escapeHtml(s.title)}</a>
            ${domain ? `<span class="domain">(<a href="${escapeHtml(s.url)}">${escapeHtml(domain)}</a>)</span>` : ""}
          </span>
          <div class="meta">
            <span class="points">${s.points}</span> point${s.points === 1 ? "" : "s"} by
            <a href="/user.html?id=${encodeURIComponent(s.user)}" class="user">${escapeHtml(s.user)}</a> ${escapeHtml(s.age)} &middot;
            <a href="/comments.html?id=${s.id}">${s.comments} comment${s.comments === 1 ? "" : "s"}</a>
          </div>
        </div>
      </li>`;
  }

  async function onVote(el) {
    if (!currentUser) {
      location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (el.classList.contains("voted")) return;
    const id = el.dataset.id;
    el.classList.add("voted");
    try {
      const res = await fetch(`/api/stories/${id}/vote`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) { el.classList.remove("voted"); return; }
      const data = await res.json();
      const pts = el.parentElement.querySelector(".points");
      if (pts) pts.textContent = data.points;
    } catch (e) {
      el.classList.remove("voted");
    }
  }

  function domainOf(url) {
    try { return new URL(url).host; }
    catch { return String(url).replace(/^https?:\/\//, "").split("/")[0]; }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setToday() {
    const el = document.getElementById("today");
    if (!el) return;
    const d = new Date();
    el.textContent = d.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setToday();
    highlightSort();
    loadMe();
    loadStories();
  });
})();
