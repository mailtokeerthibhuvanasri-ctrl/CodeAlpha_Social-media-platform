# Threadly — mini social media app

A tiny social platform: profiles, posts, comments, likes, and follows.
Backend: FastAPI + SQLite (one file, no server setup needed).
Frontend: plain HTML/CSS/JS — no build step.

## Run it

1. Install the dependencies (one time only):

   ```
   pip install -r requirements.txt
   ```

2. Start the app:

   ```
   uvicorn main:app --reload
   ```

3. Open **http://127.0.0.1:8000** in your browser.

That's it — the database file (`database.db`) is created automatically on first run.

## What you can do

- Sign up / log in, and pick a few interests (Tech, Art, Travel, etc.)
- Post something (500 char limit), optionally with tags and a pasted image or YouTube link
- Like and comment on posts
- Visit anyone's profile and follow/unfollow them
- Browse the **Discover** tab — a Pinterest-style masonry grid ranked by how well each post matches your interests, with a tag filter
- See a **"Suggested for you"** rail on the side, video/image posts prioritized
- Edit your interests anytime from Discover ("Edit interests")
- Browse the "People" tab to find others

## How the recommendations work

Each post can carry up to 6 tags. Each user picks interests from the same
fixed list. `/api/discover` scores every post by: how many of its tags match
your interests (weighted highest), whether it has an image/video attached,
then like count — so it behaves like a lightweight, transparent version of a
"for you" feed. No external ML — just simple, readable ranking logic in
`main.py` (`discover()`), easy to tweak or extend.

## Notes

- Data is stored locally in `database.db` (SQLite, git-ignored). Delete that file to reset everything.
- Passwords are hashed before storing.
- Everything runs from the single `uvicorn main:app --reload` command — no separate frontend server needed.
- If you already have a `database.db` from an earlier version, it upgrades automatically on next run (new columns are added in place, no data lost).
