"""
Threadly — a mini social media app.
Run with:  uvicorn main:app --reload
"""

import hashlib
import os
import random
import re
import secrets
import sqlite3
from datetime import datetime
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "database.db")

AVATAR_COLORS = [
    "#FF6F61", "#FFB84D", "#4FB69F", "#C77DFF",
    "#FF8FA3", "#F4A261", "#5FB49C", "#E9887E",
]

# Fixed interest taxonomy — used for signup, profile editing, and the
# Discover recommendation ranking.
INTERESTS = [
    "Tech", "Art", "Music", "Travel", "Food", "Photography",
    "Gaming", "Fashion", "Nature", "Movies", "Fitness", "Books",
]

YOUTUBE_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtube\.com/shorts/|youtu\.be/)([\w-]{11})"
)
IMAGE_RE = re.compile(r"\.(png|jpe?g|gif|webp|avif)(\?.*)?$", re.IGNORECASE)


def classify_media(url: str):
    """Return (media_type, embed_url) for a pasted link, or (None, None)."""
    url = (url or "").strip()
    if not url:
        return None, None
    yt = YOUTUBE_RE.search(url)
    if yt:
        return "video", f"https://www.youtube.com/embed/{yt.group(1)}"
    if IMAGE_RE.search(url):
        return "image", url
    return None, None


def parse_tags(raw: str) -> List[str]:
    if not raw:
        return []
    seen, out = set(), []
    for t in raw.split(","):
        t = t.strip().lower()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out[:6]

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            bio TEXT DEFAULT '',
            avatar_color TEXT DEFAULT '#FF6F61',
            interests TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            tags TEXT DEFAULT '',
            media_url TEXT DEFAULT '',
            media_type TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS likes (
            post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (post_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS follows (
            follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (follower_id, following_id)
        );
        """
    )
    conn.commit()
    _migrate(conn)
    conn.close()


def _migrate(conn):
    """Add any columns missing from an older database.db so upgrades
    don't require deleting existing data."""
    def cols(table):
        return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}

    user_cols = cols("users")
    if "interests" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN interests TEXT DEFAULT ''")

    post_cols = cols("posts")
    for col in ("tags", "media_url", "media_type"):
        if col not in post_cols:
            conn.execute(f"ALTER TABLE posts ADD COLUMN {col} TEXT DEFAULT ''")

    conn.commit()


def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Threadly")
app.add_middleware(SessionMiddleware, secret_key=secrets.token_hex(16))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

init_db()


def current_user(request: Request, db: sqlite3.Connection = Depends(get_db)):
    uid = request.session.get("user_id")
    if not uid:
        return None
    return db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


def require_user(request: Request, db: sqlite3.Connection = Depends(get_db)):
    user = current_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RegisterIn(BaseModel):
    username: str
    password: str
    bio: str = ""
    interests: List[str] = []


class LoginIn(BaseModel):
    username: str
    password: str


class PostIn(BaseModel):
    content: str
    tags: str = ""          # comma-separated, e.g. "travel, food"
    media_url: str = ""     # optional image URL or YouTube link


class CommentIn(BaseModel):
    content: str


class InterestsIn(BaseModel):
    interests: List[str] = []


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def serialize_user(db, row, viewer_id=None):
    followers = db.execute(
        "SELECT COUNT(*) c FROM follows WHERE following_id = ?", (row["id"],)
    ).fetchone()["c"]
    following = db.execute(
        "SELECT COUNT(*) c FROM follows WHERE follower_id = ?", (row["id"],)
    ).fetchone()["c"]
    posts_count = db.execute(
        "SELECT COUNT(*) c FROM posts WHERE user_id = ?", (row["id"],)
    ).fetchone()["c"]
    is_following = False
    if viewer_id and viewer_id != row["id"]:
        is_following = (
            db.execute(
                "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
                (viewer_id, row["id"]),
            ).fetchone()
            is not None
        )
    return {
        "id": row["id"],
        "username": row["username"],
        "bio": row["bio"],
        "avatar_color": row["avatar_color"],
        "interests": parse_tags(row["interests"]) if row["interests"] else [],
        "followers": followers,
        "following": following,
        "posts_count": posts_count,
        "is_following": is_following,
        "is_me": viewer_id == row["id"],
    }


def serialize_post(db, row, viewer_id=None):
    author = db.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
    likes = db.execute(
        "SELECT COUNT(*) c FROM likes WHERE post_id = ?", (row["id"],)
    ).fetchone()["c"]
    comments = db.execute(
        "SELECT COUNT(*) c FROM comments WHERE post_id = ?", (row["id"],)
    ).fetchone()["c"]
    liked = False
    if viewer_id:
        liked = (
            db.execute(
                "SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?",
                (row["id"], viewer_id),
            ).fetchone()
            is not None
        )
    return {
        "id": row["id"],
        "content": row["content"],
        "created_at": row["created_at"],
        "author": {
            "id": author["id"],
            "username": author["username"],
            "avatar_color": author["avatar_color"],
        },
        "tags": parse_tags(row["tags"]) if row["tags"] else [],
        "media_type": row["media_type"] or None,
        "media_url": row["media_url"] or None,
        "likes": likes,
        "comments": comments,
        "liked_by_me": liked,
        "is_mine": viewer_id == row["user_id"],
    }


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.get("/")
def home():
    return FileResponse(os.path.join(BASE_DIR, "templates", "index.html"))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.post("/api/register")
def register(data: RegisterIn, request: Request, db: sqlite3.Connection = Depends(get_db)):
    username = data.username.strip()
    if len(username) < 3:
        raise HTTPException(400, "Username needs at least 3 characters")
    if len(data.password) < 4:
        raise HTTPException(400, "Password needs at least 4 characters")
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        raise HTTPException(400, "That username is taken")
    color = random.choice(AVATAR_COLORS)
    interests = ",".join(i for i in data.interests if i in INTERESTS)
    cur = db.execute(
        "INSERT INTO users (username, password_hash, bio, avatar_color, interests) VALUES (?, ?, ?, ?, ?)",
        (username, hash_pw(data.password), data.bio.strip(), color, interests),
    )
    db.commit()
    request.session["user_id"] = cur.lastrowid
    user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return serialize_user(db, user, viewer_id=cur.lastrowid)


@app.post("/api/login")
def login(data: LoginIn, request: Request, db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM users WHERE username = ?", (data.username.strip(),)).fetchone()
    if not user or user["password_hash"] != hash_pw(data.password):
        raise HTTPException(400, "Wrong username or password")
    request.session["user_id"] = user["id"]
    return serialize_user(db, user, viewer_id=user["id"])


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request, db: sqlite3.Connection = Depends(get_db)):
    user = current_user(request, db)
    if not user:
        return {"user": None}
    return {"user": serialize_user(db, user, viewer_id=user["id"])}


@app.get("/api/interests")
def list_interests():
    return INTERESTS


@app.post("/api/me/interests")
def update_my_interests(
    data: InterestsIn, user=Depends(require_user), db: sqlite3.Connection = Depends(get_db)
):
    interests = ",".join(i for i in data.interests if i in INTERESTS)
    db.execute("UPDATE users SET interests = ? WHERE id = ?", (interests, user["id"]))
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return serialize_user(db, row, viewer_id=user["id"])


# ---------------------------------------------------------------------------
# Feed & Posts
# ---------------------------------------------------------------------------

@app.get("/api/feed")
def feed(request: Request, db: sqlite3.Connection = Depends(get_db)):
    viewer = current_user(request, db)
    viewer_id = viewer["id"] if viewer else None
    rows = db.execute("SELECT * FROM posts ORDER BY id DESC").fetchall()
    return [serialize_post(db, r, viewer_id) for r in rows]


@app.post("/api/posts")
def create_post(data: PostIn, user=Depends(require_user), db: sqlite3.Connection = Depends(get_db)):
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Post can't be empty")
    if len(content) > 500:
        raise HTTPException(400, "Post is too long (max 500 characters)")
    tags = ",".join(parse_tags(data.tags))
    media_type, media_url = classify_media(data.media_url)
    if data.media_url.strip() and not media_type:
        raise HTTPException(400, "That link doesn't look like an image or a YouTube video")
    cur = db.execute(
        "INSERT INTO posts (user_id, content, tags, media_url, media_type) VALUES (?, ?, ?, ?, ?)",
        (user["id"], content, tags, media_url or "", media_type or ""),
    )
    db.commit()
    row = db.execute("SELECT * FROM posts WHERE id = ?", (cur.lastrowid,)).fetchone()
    return serialize_post(db, row, viewer_id=user["id"])


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, user=Depends(require_user), db: sqlite3.Connection = Depends(get_db)):
    post = db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not post:
        raise HTTPException(404, "Post not found")
    if post["user_id"] != user["id"]:
        raise HTTPException(403, "You can only delete your own posts")
    db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
    db.commit()
    return {"ok": True}


@app.post("/api/posts/{post_id}/like")
def toggle_like(post_id: int, user=Depends(require_user), db: sqlite3.Connection = Depends(get_db)):
    post = db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not post:
        raise HTTPException(404, "Post not found")
    existing = db.execute(
        "SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?", (post_id, user["id"])
    ).fetchone()
    if existing:
        db.execute("DELETE FROM likes WHERE post_id = ? AND user_id = ?", (post_id, user["id"]))
    else:
        db.execute("INSERT INTO likes (post_id, user_id) VALUES (?, ?)", (post_id, user["id"]))
    db.commit()
    row = db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    return serialize_post(db, row, viewer_id=user["id"])


@app.get("/api/posts/{post_id}/comments")
def list_comments(post_id: int, db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        "SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC", (post_id,)
    ).fetchall()
    out = []
    for r in rows:
        author = db.execute("SELECT * FROM users WHERE id = ?", (r["user_id"],)).fetchone()
        out.append(
            {
                "id": r["id"],
                "content": r["content"],
                "created_at": r["created_at"],
                "author": {
                    "username": author["username"],
                    "avatar_color": author["avatar_color"],
                },
            }
        )
    return out


@app.post("/api/posts/{post_id}/comments")
def add_comment(
    post_id: int,
    data: CommentIn,
    user=Depends(require_user),
    db: sqlite3.Connection = Depends(get_db),
):
    post = db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not post:
        raise HTTPException(404, "Post not found")
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Comment can't be empty")
    db.execute(
        "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)",
        (post_id, user["id"], content),
    )
    db.commit()
    return list_comments(post_id, db)


# ---------------------------------------------------------------------------
# Profiles & follow
# ---------------------------------------------------------------------------

@app.get("/api/users/{username}")
def get_profile(username: str, request: Request, db: sqlite3.Connection = Depends(get_db)):
    viewer = current_user(request, db)
    viewer_id = viewer["id"] if viewer else None
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    posts = db.execute(
        "SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC", (row["id"],)
    ).fetchall()
    return {
        "profile": serialize_user(db, row, viewer_id),
        "posts": [serialize_post(db, p, viewer_id) for p in posts],
    }


@app.post("/api/users/{username}/follow")
def toggle_follow(
    username: str, user=Depends(require_user), db: sqlite3.Connection = Depends(get_db)
):
    target = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not target:
        raise HTTPException(404, "User not found")
    if target["id"] == user["id"]:
        raise HTTPException(400, "You can't follow yourself")
    existing = db.execute(
        "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
        (user["id"], target["id"]),
    ).fetchone()
    if existing:
        db.execute(
            "DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
            (user["id"], target["id"]),
        )
    else:
        db.execute(
            "INSERT INTO follows (follower_id, following_id) VALUES (?, ?)",
            (user["id"], target["id"]),
        )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    return serialize_user(db, row, viewer_id=user["id"])


@app.get("/api/people")
def list_people(request: Request, db: sqlite3.Connection = Depends(get_db)):
    viewer = current_user(request, db)
    viewer_id = viewer["id"] if viewer else None
    rows = db.execute("SELECT * FROM users ORDER BY id DESC").fetchall()
    return [serialize_user(db, r, viewer_id) for r in rows if not viewer_id or r["id"] != viewer_id]


# ---------------------------------------------------------------------------
# Discover — a Pinterest-style, interest-ranked feed
# ---------------------------------------------------------------------------

@app.get("/api/discover")
def discover(
    request: Request,
    tag: Optional[str] = None,
    videos_only: bool = False,
    limit: int = 60,
    db: sqlite3.Connection = Depends(get_db),
):
    viewer = current_user(request, db)
    viewer_id = viewer["id"] if viewer else None
    my_interests = set(parse_tags(viewer["interests"])) if viewer and viewer["interests"] else set()

    rows = db.execute("SELECT * FROM posts ORDER BY id DESC").fetchall()

    scored = []
    for r in rows:
        post_tags = set(parse_tags(r["tags"]))
        if tag and tag.lower() not in post_tags:
            continue
        if videos_only and r["media_type"] != "video":
            continue
        likes = db.execute(
            "SELECT COUNT(*) c FROM likes WHERE post_id = ?", (r["id"],)
        ).fetchone()["c"]
        match = len(post_tags & my_interests)
        has_media_bonus = 1 if r["media_type"] else 0
        # Rank: interest match first, then media (video/image) posts,
        # then popularity, then recency (id desc already applied as a tiebreak).
        score = (match * 100) + (has_media_bonus * 10) + likes
        scored.append((score, r))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [serialize_post(db, r, viewer_id) for _, r in scored[:limit]]
