// ============================================================
// Threadly — frontend logic (vanilla JS, no build step)
// ============================================================

const state = {
  me: null,
  activeView: "feed",
  activePostId: null, // for comments modal
  viewedUsername: null,
  interests: [],
  activeTag: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------- API helper ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Something went wrong");
  }
  return data;
}

function timeAgo(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z");
  const diff = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

function avatarHTML(user, size = "") {
  const cls = size ? `avatar avatar--${size}` : "avatar";
  return `<div class="${cls}" style="background:${user.avatar_color}">${initials(user.username)}</div>`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("is-visible"), 2200);
}

// ---------------- Auth ----------------
async function openAuthModal(tab = "login") {
  $("#authModal").classList.add("is-open");
  switchAuthTab(tab);
  await loadInterestsList();
  renderChipPicker($("#registerInterests"), []);
}
function closeAuthModal() {
  $("#authModal").classList.remove("is-open");
  $("#loginError").textContent = "";
  $("#registerError").textContent = "";
}
function switchAuthTab(tab) {
  $$(".modal__tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
  $("#loginForm").classList.toggle("is-active", tab === "login");
  $("#registerForm").classList.toggle("is-active", tab === "register");
}

async function refreshMe() {
  const data = await api("/api/me");
  state.me = data.user;
  renderAuthArea();
  renderMeCard();
}

function renderAuthArea() {
  const area = $("#authArea");
  if (state.me) {
    area.innerHTML = `
      <div class="user-chip">
        ${avatarHTML(state.me, "sm")}
        <span class="user-chip__name">${escapeHTML(state.me.username)}</span>
        <button class="btn btn--ghost" id="logoutBtn">Log out</button>
      </div>`;
    $("#logoutBtn").onclick = async () => {
      await api("/api/logout", { method: "POST" });
      state.me = null;
      renderAuthArea();
      renderMeCard();
      toast("Logged out");
      loadFeed();
    };
    $("#app").hidden = false;
  } else {
    area.innerHTML = `
      <button class="btn btn--ghost" id="loginBtn">Log in</button>
      <button class="btn btn--primary" id="signupBtn">Sign up</button>`;
    $("#loginBtn").onclick = () => openAuthModal("login");
    $("#signupBtn").onclick = () => openAuthModal("register");
    $("#app").hidden = false;
  }
}

function renderMeCard() {
  const el = $("#meCard");
  if (!state.me) {
    el.innerHTML = `
      <p style="margin:0 0 10px;font-family:'Fraunces',serif;font-size:17px;">Join the thread</p>
      <p style="margin:0 0 14px;font-size:13px;color:var(--ink-soft);">Sign up to post, like, and follow people.</p>
      <button class="btn btn--primary" style="width:100%" id="meCardSignup">Sign up</button>`;
    $("#meCardSignup").onclick = () => openAuthModal("register");
    return;
  }
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      ${avatarHTML(state.me, "lg")}
      <div>
        <div style="font-weight:700;font-size:17px;">${escapeHTML(state.me.username)}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${state.me.followers} followers · ${state.me.following} following</div>
      </div>
    </div>
    ${state.me.bio ? `<p style="font-size:13px;color:var(--ink-soft);margin:12px 0 0;">${escapeHTML(state.me.bio)}</p>` : ""}
  `;
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------- Views ----------------
function switchView(view) {
  state.activeView = view;
  $$(".nav__item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
  $("#view-feed").hidden = view !== "feed";
  $("#view-discover").hidden = view !== "discover";
  $("#view-profile").hidden = view !== "profile";
  $("#view-people").hidden = view !== "people";
  $("#rail").hidden = view === "people" || view === "profile";
  if (view === "feed") { loadFeed(); loadRail(); }
  if (view === "discover") { loadDiscover(); loadRail(); }
  if (view === "profile") loadProfile(state.me ? state.me.username : null);
  if (view === "people") loadPeople();
}

// ---------------- Feed ----------------
async function loadFeed() {
  const posts = await api("/api/feed");
  renderPosts($("#feedPosts"), posts);
}

function renderPosts(container, posts) {
  if (!posts.length) {
    container.innerHTML = `<div class="empty-state"><strong>Nothing here yet</strong>Be the first to post something.</div>`;
    return;
  }
  container.innerHTML = posts.map(postHTML).join("");
  posts.forEach((p) => {
    const el = container.querySelector(`[data-post-id="${p.id}"]`);
    wirePost(el, p);
  });
}

function mediaHTML(p, iframeClass = "") {
  if (!p.media_type || !p.media_url) return "";
  if (p.media_type === "video") {
    return `<div class="post__media"><iframe class="${iframeClass}" src="${escapeAttr(p.media_url)}" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return `<div class="post__media"><img src="${escapeAttr(p.media_url)}" loading="lazy" alt="" /></div>`;
}
function escapeAttr(s) {
  return (s || "").replace(/"/g, "&quot;");
}
function tagsHTML(p) {
  if (!p.tags || !p.tags.length) return "";
  return `<div class="post__tags">${p.tags
    .map((t) => `<button class="post__tag" data-tag="${escapeHTML(t)}">#${escapeHTML(t)}</button>`)
    .join("")}</div>`;
}

function postHTML(p) {
  return `
    <article class="post" data-post-id="${p.id}">
      <div class="post__avatar-col">${avatarHTML(p.author)}</div>
      <div class="post__body">
        <div class="post__head">
          <span class="post__author" data-username="${escapeHTML(p.author.username)}">${escapeHTML(p.author.username)}</span>
          <span class="post__time">${timeAgo(p.created_at)}</span>
        </div>
        <p class="post__content">${escapeHTML(p.content)}</p>
        ${mediaHTML(p)}
        ${tagsHTML(p)}
        <div class="post__actions">
          <button class="btn--icon like-btn ${p.liked_by_me ? "is-liked" : ""}">♥ ${p.likes}</button>
          <button class="btn--icon comment-btn">💬 ${p.comments}</button>
          ${p.is_mine ? `<button class="post__delete">Delete</button>` : ""}
        </div>
      </div>
    </article>`;
}

function wirePost(el, p) {
  if (!el) return;
  $(".post__author", el).onclick = () => {
    switchView("profile");
    loadProfile(p.author.username);
  };
  $(".like-btn", el).onclick = async () => {
    if (!requireAuth()) return;
    const updated = await api(`/api/posts/${p.id}/like`, { method: "POST" });
    const btn = $(".like-btn", el);
    btn.textContent = `♥ ${updated.likes}`;
    btn.classList.toggle("is-liked", updated.liked_by_me);
  };
  $(".comment-btn", el).onclick = () => openComments(p.id);
  $$(".post__tag", el).forEach((btn) => {
    btn.onclick = () => {
      switchView("discover");
      setTimeout(() => setDiscoverTag(btn.dataset.tag), 0);
    };
  });
  const delBtn = $(".post__delete", el);
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!confirm("Delete this post?")) return;
      await api(`/api/posts/${p.id}`, { method: "DELETE" });
      toast("Post deleted");
      if (state.activeView === "profile") loadProfile(state.viewedUsername);
      else loadFeed();
    };
  }
}

function requireAuth() {
  if (!state.me) {
    openAuthModal("login");
    toast("Log in first");
    return false;
  }
  return true;
}

// ---------------- Composer ----------------
$("#toggleExtra").addEventListener("click", () => {
  const extra = $("#composerExtra");
  extra.hidden = !extra.hidden;
  $("#toggleExtra").textContent = extra.hidden ? "+ Tags & media" : "− Tags & media";
});

$("#composerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth()) return;
  const text = $("#composerText");
  const content = text.value.trim();
  if (!content) return;
  try {
    await api("/api/posts", {
      method: "POST",
      body: {
        content,
        tags: $("#composerTags").value.trim(),
        media_url: $("#composerMedia").value.trim(),
      },
    });
    text.value = "";
    $("#composerTags").value = "";
    $("#composerMedia").value = "";
    $("#composerCount").textContent = "500";
    toast("Posted!");
    loadFeed();
    loadRail();
  } catch (err) {
    toast(err.message);
  }
});
$("#composerText").addEventListener("input", (e) => {
  $("#composerCount").textContent = 500 - e.target.value.length;
});
$("#composerText").addEventListener("focus", () => {
  if (!state.me) {
    $("#composerText").blur();
    openAuthModal("login");
  }
});

// ---------------- Interests (chip picker) ----------------
async function loadInterestsList() {
  if (state.interests.length) return state.interests;
  state.interests = await api("/api/interests");
  return state.interests;
}

function renderChipPicker(container, selected = []) {
  container.innerHTML = state.interests
    .map(
      (tag) =>
        `<button type="button" class="chip ${selected.includes(tag) ? "is-active" : ""}" data-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`
    )
    .join("");
  $$(".chip", container).forEach((chip) => {
    chip.onclick = () => chip.classList.toggle("is-active");
  });
}

function getSelectedChips(container) {
  return $$(".chip.is-active", container).map((c) => c.dataset.tag);
}

$("#saveInterests").addEventListener("click", async () => {
  const interests = getSelectedChips($("#editInterests"));
  const updated = await api("/api/me/interests", { method: "POST", body: { interests } });
  state.me = updated;
  renderMeCard();
  closeInterestsModal();
  toast("Interests updated");
  if (state.activeView === "discover") loadDiscover();
});
$("#closeInterests").addEventListener("click", closeInterestsModal);
$("#interestsModal").addEventListener("click", (e) => {
  if (e.target.id === "interestsModal") closeInterestsModal();
});
function openInterestsModal() {
  renderChipPicker($("#editInterests"), state.me ? state.me.interests : []);
  $("#interestsModal").classList.add("is-open");
}
function closeInterestsModal() {
  $("#interestsModal").classList.remove("is-open");
}
$("#editInterestsBtn").addEventListener("click", () => {
  if (!requireAuth()) return;
  openInterestsModal();
});

// ---------------- Discover (Pinterest-style masonry) ----------------
async function loadDiscover() {
  await loadInterestsList();
  renderTagFilter();
  const q = state.activeTag ? `?tag=${encodeURIComponent(state.activeTag)}` : "";
  const posts = await api(`/api/discover${q}`);
  const grid = $("#discoverGrid");
  if (!posts.length) {
    grid.innerHTML = `<div class="empty-state"><strong>Nothing to discover yet</strong>Post something with a tag or a video/image link.</div>`;
    return;
  }
  grid.innerHTML = posts.map(masonryCardHTML).join("");
  posts.forEach((p) => wireMasonryCard(grid.querySelector(`[data-post-id="${p.id}"]`), p));
}

function renderTagFilter() {
  const el = $("#tagFilter");
  el.innerHTML =
    `<button class="chip ${!state.activeTag ? "is-active" : ""}" data-tag="">All</button>` +
    state.interests
      .map((t) => `<button class="chip ${state.activeTag === t.toLowerCase() ? "is-active" : ""}" data-tag="${escapeHTML(t.toLowerCase())}">${escapeHTML(t)}</button>`)
      .join("");
  $$(".chip", el).forEach((chip) => {
    chip.onclick = () => setDiscoverTag(chip.dataset.tag || null);
  });
}
function setDiscoverTag(tag) {
  state.activeTag = tag || null;
  loadDiscover();
}

function masonryCardHTML(p) {
  const media = p.media_type
    ? mediaHTML(p, "")
        .replace('class="post__media"', 'class="masonry-card__media"')
    : `<div class="masonry-card__media masonry-card__media--none">${escapeHTML(p.content.slice(0, 90))}${p.content.length > 90 ? "…" : ""}</div>`;
  return `
    <div class="masonry-card" data-post-id="${p.id}">
      ${media}
      <div class="masonry-card__body">
        <div class="masonry-card__author" data-username="${escapeHTML(p.author.username)}">
          ${avatarHTML(p.author, "sm")} ${escapeHTML(p.author.username)}
        </div>
        ${p.media_type ? `<p class="masonry-card__text">${escapeHTML(p.content.slice(0, 80))}${p.content.length > 80 ? "…" : ""}</p>` : ""}
        ${tagsHTML(p)}
        <div class="masonry-card__foot">
          <button class="btn--icon like-btn ${p.liked_by_me ? "is-liked" : ""}">♥ ${p.likes}</button>
          <button class="btn--icon comment-btn">💬 ${p.comments}</button>
        </div>
      </div>
    </div>`;
}

function wireMasonryCard(el, p) {
  if (!el) return;
  $(".masonry-card__author", el).onclick = () => {
    switchView("profile");
    loadProfile(p.author.username);
  };
  $(".like-btn", el).onclick = async () => {
    if (!requireAuth()) return;
    const updated = await api(`/api/posts/${p.id}/like`, { method: "POST" });
    const btn = $(".like-btn", el);
    btn.textContent = `♥ ${updated.likes}`;
    btn.classList.toggle("is-liked", updated.liked_by_me);
  };
  $(".comment-btn", el).onclick = () => openComments(p.id);
  $$(".post__tag", el).forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      setDiscoverTag(btn.dataset.tag);
    };
  });
}

// ---------------- Suggested-for-you rail ----------------
async function loadRail() {
  const posts = await api("/api/discover?limit=6");
  const list = $("#railList");
  if (!posts.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--ink-soft);">Post or follow people to see suggestions here.</p>`;
    return;
  }
  list.innerHTML = posts
    .map((p) => {
      const thumb = p.media_type
        ? p.media_type === "image"
          ? `<img src="${escapeAttr(p.media_url)}" alt="" />`
          : "▶"
        : "✎";
      return `
      <div class="rail-item" data-post-id="${p.id}">
        <div class="rail-item__thumb">${thumb}</div>
        <div class="rail-item__text">
          <div class="rail-item__author">${escapeHTML(p.author.username)}</div>
          <div class="rail-item__snippet">${escapeHTML(p.content.slice(0, 60))}</div>
        </div>
      </div>`;
    })
    .join("");
  $$(".rail-item", list).forEach((item, i) => {
    item.onclick = () => {
      switchView("discover");
    };
  });
}

// ---------------- Profile ----------------
async function loadProfile(username) {
  if (!username) {
    $("#profileHeader").innerHTML = `<div class="empty-state"><strong>No profile yet</strong>Log in to see your profile.</div>`;
    $("#profilePosts").innerHTML = "";
    return;
  }
  state.viewedUsername = username;
  const data = await api(`/api/users/${encodeURIComponent(username)}`);
  renderProfileHeader(data.profile);
  renderPosts($("#profilePosts"), data.posts);
}

function renderProfileHeader(profile) {
  const el = $("#profileHeader");
  el.innerHTML = `
    ${avatarHTML(profile, "lg")}
    <div class="profile-header__info">
      <p class="profile-header__name">${escapeHTML(profile.username)}</p>
      <p class="profile-header__bio">${escapeHTML(profile.bio || "No bio yet.")}</p>
      <div class="profile-header__stats">
        <span><b>${profile.posts_count}</b> posts</span>
        <span><b>${profile.followers}</b> followers</span>
        <span><b>${profile.following}</b> following</span>
      </div>
    </div>
    ${
      profile.is_me
        ? ""
        : `<button class="btn ${profile.is_following ? "btn--sage is-active" : "btn--primary"}" id="followBtn">
             ${profile.is_following ? "Following" : "Follow"}
           </button>`
    }
  `;
  const followBtn = $("#followBtn");
  if (followBtn) {
    followBtn.onclick = async () => {
      if (!requireAuth()) return;
      const updated = await api(`/api/users/${encodeURIComponent(profile.username)}/follow`, { method: "POST" });
      renderProfileHeader(updated);
      refreshMe();
    };
  }
}

// ---------------- People ----------------
async function loadPeople() {
  const people = await api("/api/people");
  const grid = $("#peopleGrid");
  if (!people.length) {
    grid.innerHTML = `<div class="empty-state"><strong>It's quiet in here</strong>No one else has joined yet.</div>`;
    return;
  }
  grid.innerHTML = people
    .map(
      (p) => `
    <div class="person-card" data-username="${escapeHTML(p.username)}">
      <div class="person-card__top">
        ${avatarHTML(p)}
        <div>
          <div class="person-card__name">${escapeHTML(p.username)}</div>
          <div style="font-size:12px;color:var(--ink-soft);">${p.followers} followers</div>
        </div>
      </div>
      <div class="person-card__bio">${escapeHTML(p.bio || "")}</div>
      <button class="btn btn--small ${p.is_following ? "btn--sage is-active" : "btn--primary"}" data-follow="${escapeHTML(p.username)}">
        ${p.is_following ? "Following" : "Follow"}
      </button>
    </div>`
    )
    .join("");

  $$(".person-card__name", grid).forEach((n) => {
    n.onclick = () => {
      switchView("profile");
      loadProfile(n.closest(".person-card").dataset.username);
    };
  });
  $$("[data-follow]", grid).forEach((btn) => {
    btn.onclick = async () => {
      if (!requireAuth()) return;
      await api(`/api/users/${encodeURIComponent(btn.dataset.follow)}/follow`, { method: "POST" });
      loadPeople();
    };
  });
}

// ---------------- Comments modal ----------------
async function openComments(postId) {
  state.activePostId = postId;
  $("#commentsModal").classList.add("is-open");
  await renderComments();
}
function closeComments() {
  $("#commentsModal").classList.remove("is-open");
  state.activePostId = null;
}
async function renderComments() {
  const comments = await api(`/api/posts/${state.activePostId}/comments`);
  const list = $("#commentsList");
  if (!comments.length) {
    list.innerHTML = `<div class="empty-state"><strong>No comments yet</strong>Start the conversation.</div>`;
    return;
  }
  list.innerHTML = comments
    .map(
      (c) => `
    <div class="comment">
      ${avatarHTML(c.author, "sm")}
      <div class="comment__body">
        <div class="comment__author">${escapeHTML(c.author.username)}</div>
        <div class="comment__text">${escapeHTML(c.content)}</div>
      </div>
    </div>`
    )
    .join("");
}

$("#commentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth()) return;
  const input = $("#commentInput");
  const content = input.value.trim();
  if (!content) return;
  await api(`/api/posts/${state.activePostId}/comments`, { method: "POST", body: { content } });
  input.value = "";
  await renderComments();
  loadFeed();
  if (state.activeView === "profile") loadProfile(state.viewedUsername);
});

// ---------------- Wire up static UI ----------------
$$(".modal__tab").forEach((btn) => {
  btn.addEventListener("click", () => switchAuthTab(btn.dataset.tab));
});
$("#closeModal").addEventListener("click", closeAuthModal);
$("#authModal").addEventListener("click", (e) => {
  if (e.target.id === "authModal") closeAuthModal();
});
$("#closeComments").addEventListener("click", closeComments);
$("#commentsModal").addEventListener("click", (e) => {
  if (e.target.id === "commentsModal") closeComments();
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/login", { method: "POST", body: { username: fd.get("username"), password: fd.get("password") } });
    closeAuthModal();
    await refreshMe();
    toast("Welcome back!");
    switchView(state.activeView);
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/register", {
      method: "POST",
      body: {
        username: fd.get("username"),
        password: fd.get("password"),
        bio: fd.get("bio") || "",
        interests: getSelectedChips($("#registerInterests")),
      },
    });
    closeAuthModal();
    await refreshMe();
    toast("Welcome to Threadly!");
    switchView(state.activeView);
  } catch (err) {
    $("#registerError").textContent = err.message;
  }
});

$$(".nav__item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---------------- Boot ----------------
(async function init() {
  await refreshMe();
  switchView("feed");
})();
