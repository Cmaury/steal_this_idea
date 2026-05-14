(function () {
  "use strict";

  const stories = [
    { title: "Show G: Inkpot — a CMS that won't fight your editor", url: "github.com/jane/inkpot", points: 412, user: "j_press", age: "2 hours ago", comments: 187 },
    { title: "We scraped 100,000 PDFs from city hall. Here's what we found.", url: "newsroomlabs.org/pdf-dump", points: 388, user: "foia_finn", age: "3 hours ago", comments: 142 },
    { title: "The quiet death of the beat reporter, in three charts", url: "press-gazette.example/death-of-beats", points: 351, user: "broadsheet", age: "4 hours ago", comments: 263 },
    { title: "Ask G: What's your OCR stack for handwritten archives in 2026?", points: 298, user: "archive_mole", age: "5 hours ago", comments: 211 },
    { title: "A reporter's guide to running your own Tor relay", url: "torproject.org/journalist-relays", points: 276, user: "onionwriter", age: "5 hours ago", comments: 88 },
    { title: "I rewrote our newsroom Slack bot in 200 lines of Go", url: "small-paper-dev.example/slack-bot", points: 244, user: "deskhand", age: "6 hours ago", comments: 73 },
    { title: "Show G: Stylebook.lint — a CLI that catches AP-style violations in copy", url: "github.com/copydesk/stylebook-lint", points: 231, user: "copydesk", age: "7 hours ago", comments: 119 },
    { title: "Court records, but as a queryable database (open source)", url: "free-law.example/courtdb", points: 218, user: "docket_dan", age: "7 hours ago", comments: 64 },
    { title: "Why our investigations team moved off Google Docs", url: "longform-co.example/we-left-docs", points: 197, user: "redpencil", age: "8 hours ago", comments: 312 },
    { title: "The Pentagon Papers, but the diff", url: "diff-history.example/pentagon", points: 192, user: "ellsbergfan", age: "9 hours ago", comments: 41 },
    { title: "How I built a satellite-image pipeline on a $20/mo budget", url: "geo-hack.example/sat-pipeline", points: 184, user: "above_groundtruth", age: "9 hours ago", comments: 56 },
    { title: "Ask G: How do you fact-check generative video in a deadline crunch?", points: 172, user: "fcheck", age: "10 hours ago", comments: 198 },
    { title: "A short, opinionated history of the inverted pyramid", url: "niemanlab.example/inverted-pyramid", points: 161, user: "lede_buryer", age: "11 hours ago", comments: 47 },
    { title: "Show G: A static-site generator with built-in corrections", url: "github.com/desk/correctly", points: 154, user: "stetlife", age: "12 hours ago", comments: 33 },
    { title: "Inside the newsroom that ships software like a startup", url: "tech-press.example/shipping-news", points: 148, user: "ctrl_alt_edit", age: "12 hours ago", comments: 81 },
    { title: "We open-sourced our paywall. Please don't burn it down.", url: "github.com/medium-paper/paywall", points: 141, user: "biz_side", age: "13 hours ago", comments: 226 },
    { title: "Reverse-engineering a 1987 typesetting system, for fun", url: "old-iron.example/quark87", points: 132, user: "kerning", age: "14 hours ago", comments: 28 },
    { title: "What 12 years of Pulitzer entries reveal about narrative shape", url: "data-stories.example/pulitzer-shapes", points: 127, user: "arc_finder", age: "15 hours ago", comments: 52 },
    { title: "A practical guide to source protection for engineers", url: "fpf.example/source-protection", points: 119, user: "leakproof", age: "16 hours ago", comments: 39 },
    { title: "Show G: Type-safe AP datelines for your CMS", url: "github.com/wire/datelines", points: 114, user: "wireboy", age: "16 hours ago", comments: 21 },
    { title: "Why we moved our archive off the cloud and into a closet", url: "morgue-files.example/closet", points: 108, user: "morgue", age: "17 hours ago", comments: 95 },
    { title: "OSINT for police-scanner audio, with off-the-shelf tools", url: "scanner-hack.example/osint-audio", points: 102, user: "10-4", age: "18 hours ago", comments: 44 },
    { title: "The CMS migration that ate 18 months of my life", url: "longform-co.example/cms-migration", points: 96, user: "burned_out", age: "19 hours ago", comments: 134 },
    { title: "Building a newsletter platform with SQLite and a prayer", url: "tiny-stack.example/sqlite-newsletter", points: 91, user: "subscribe", age: "20 hours ago", comments: 37 },
    { title: "A photographer's encrypted backup pipeline (with rsync.net)", url: "shutter-ops.example/encrypted-backups", points: 84, user: "darkroom", age: "21 hours ago", comments: 25 },
    { title: "Ask G: Best font pairings for long-form on the web?", points: 79, user: "ligature", age: "22 hours ago", comments: 168 },
    { title: "The case for plain-text reporting notebooks", url: "plain-notes.example/case", points: 72, user: "asciiwriter", age: "23 hours ago", comments: 61 },
    { title: "Show G: A diff viewer designed for editors, not engineers", url: "github.com/desk/wordwise", points: 66, user: "wordwise", age: "1 day ago", comments: 19 },
    { title: "Lessons from running a one-person investigative newsroom", url: "solo-press.example/lessons", points: 59, user: "the_whole_desk", age: "1 day ago", comments: 73 },
    { title: "Hiring: Senior data reporter / tooling engineer (remote)", url: "jobs.example/data-reporter", points: 0, user: "hr_press", age: "1 day ago", comments: 0, job: true }
  ];

  function domainOf(url) {
    if (!url) return "";
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderStories() {
    const ol = document.getElementById("story-list");
    if (!ol) return;

    ol.innerHTML = stories
      .map((s, i) => {
        const url = s.url
          ? (s.url.startsWith("http") ? s.url : "https://" + s.url)
          : "comments.html?id=" + i;
        const domain = s.url ? domainOf(s.url) : "";
        const metaLine = s.job
          ? `<span class="user">${escapeHtml(s.user)}</span> &middot; ${escapeHtml(s.age)} &middot; <a href="#">hide</a>`
          : `<span class="points">${s.points}</span> points by <a href="#" class="user">${escapeHtml(s.user)}</a> ${escapeHtml(s.age)} &middot; <a href="#">hide</a> &middot; <a href="comments.html?id=${i}">${s.comments} comments</a>`;

        return `
          <li class="story">
            <span class="rank">${i + 1}.</span>
            <span class="upvote" data-i="${i}" title="upvote" aria-label="upvote">&#9650;</span>
            <div class="story-body">
              <span class="story-title">
                <a href="${escapeHtml(url)}">${escapeHtml(s.title)}</a>
                ${domain ? `<span class="domain">(<a href="#">${escapeHtml(domain)}</a>)</span>` : ""}
              </span>
              <div class="meta">${metaLine}</div>
            </div>
          </li>`;
      })
      .join("");

    ol.querySelectorAll(".upvote").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.classList.contains("voted")) return;
        const i = +el.dataset.i;
        if (stories[i].job) return;
        stories[i].points += 1;
        el.classList.add("voted");
        const pts = el.parentElement.querySelector(".points");
        if (pts) pts.textContent = stories[i].points;
      });
    });
  }

  function setToday() {
    const el = document.getElementById("today");
    if (!el) return;
    const d = new Date();
    const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    el.textContent = d.toLocaleDateString("en-US", opts);
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderStories();
    setToday();
  });
})();
