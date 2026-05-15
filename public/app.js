(function () {
  "use strict";

  let currentUser = null;

  async function loadMe() {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      currentUser = data.user;
      window.gutter.currentUser = currentUser;
      renderAuth();
    } catch (e) { /* ignore */ }
  }

  function renderAuth() {
    const el = document.querySelector(".auth-nav");
    if (!el || !currentUser) return;
    el.outerHTML =
      `<a href="#" class="user auth-nav">${escapeHtml(currentUser.username)}</a>` +
      ` <span class="sep">|</span> ` +
      `<a href="#" class="logout auth-nav">logout</a>`;
    const lo = document.querySelector(".logout");
    if (lo) lo.addEventListener("click", async (e) => {
      e.preventDefault();
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      location.reload();
    });
  }

  async function loadStories() {
    const ol = document.getElementById("story-list");
    if (!ol) return;
    const sort = new URLSearchParams(location.search).get("sort") === "new" ? "new" : "top";
    ol.innerHTML = `<li class="loading"><em>Going to press&hellip;</em></li>`;
    try {
      const res = await fetch(`/api/stories?sort=${sort}`, { credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) {
        ol.innerHTML = `<li class="loading"><em>${escapeHtml(data.error || "Failed to load.")}</em></li>`;
        return;
      }
      renderStories(data.stories || []);
    } catch (e) {
      ol.innerHTML = `<li class="loading"><em>Failed to load the front page.</em></li>`;
    }
  }

  function renderStories(stories) {
    const ol = document.getElementById("story-list");
    if (!ol) return;
    if (stories.length === 0) {
      ol.innerHTML =
        `<li class="empty"><em>No stories yet. ` +
        `<a href="/submit.html">Be the first to file one.</a></em></li>`;
      return;
    }
    ol.innerHTML = stories.map((s, i) => storyHtml(s, i)).join("");
    ol.querySelectorAll(".upvote").forEach((el) => {
      el.addEventListener("click", () => onVote(el));
    });
  }

  function storyHtml(s, i) {
    const url = s.url || `/comments.html?id=${s.id}`;
    const domain = s.url ? domainOf(s.url) : "";
    return `
      <li class="story" data-id="${s.id}">
        <span class="rank">${i + 1}.</span>
        <span class="upvote ${s.voted ? "voted" : ""}" data-id="${s.id}" title="upvote" aria-label="upvote">&#9650;</span>
        <div class="story-body">
          <span class="story-title">
            <a href="${escapeHtml(url)}">${escapeHtml(s.title)}</a>
            ${domain ? `<span class="domain">(<a href="${escapeHtml(s.url)}">${escapeHtml(domain)}</a>)</span>` : ""}
          </span>
          <div class="meta">
            <span class="points">${s.points}</span> point${s.points === 1 ? "" : "s"} by
            <a href="#" class="user">${escapeHtml(s.user)}</a> ${escapeHtml(s.age)} &middot;
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

  window.gutter = { loadMe, escapeHtml, domainOf, setToday, currentUser: null };

  document.addEventListener("DOMContentLoaded", () => {
    setToday();
    loadMe();
    loadStories();
  });
})();
