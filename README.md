# CodeAlpha_Social-media-platform
Threadly is a full-featured social media web application designed to bring people together. Share updates, engage in threaded conversations, explore trending topics, and connect with communities in a fast, responsive, and intuitive interface.
# 🧵 Threadly

A mini social media app — profiles, posts, comments, likes, follows, and a Pinterest-style **Discover** feed that recommends posts based on your interests.

Built with **FastAPI** (Python) + **SQLite** on the backend, and plain **HTML/CSS/JavaScript** on the frontend — no frameworks, no build step.

---

## ✨ Features

- 🔐 Sign up / log in (passwords hashed, session-based auth)
- 📝 Post text, tag it, and attach an image or YouTube link
- ❤️ Like posts, 💬 comment on them
- 👤 User profiles with bio + stats
- ➕ Follow / unfollow people
- 🎯 **Discover** tab — a masonry grid ranked by how well posts match your interests (Tech, Art, Music, Travel, Food, Gaming, and more)
- 📺 "Suggested for you" sidebar, video/image posts prioritized
- 🎨 Warm, vibrant, custom-designed UI (no generic templates)

---

## 🚀 Run it locally

**1. Clone the repo**
```bash
git clone https://github.com/<your-username>/threadly.git
cd threadly
```
*(If you downloaded the zip instead, just `cd` into the extracted `social-app` folder.)*

**2. Install the dependencies**
```bash
python -m pip install -r requirements.txt
```

**3. Start the app**
```bash
python -m uvicorn main:app --reload
```

**4. Open it in your browser**
That's it — no database setup needed. A `database.db` (SQLite) file is created automatically the first time you run it.

> 💡 **Why `python -m` for both commands?** It guarantees pip installs the packages into the *same* Python environment that runs the app. If you use plain `pip install` + `uvicorn` and your machine has more than one Python installed, they can silently point to different environments and you'll get a `ModuleNotFoundError` even though the install "succeeded."

### If `python` doesn't work, try `python3`
```bash
python3 -m pip install -r requirements.txt
python3 -m uvicorn main:app --reload
```

### Windows PowerShell users
```powershell
py -m pip install -r requirements.txt
py -m uvicorn main:app --reload
```

---

## 🗂️ Project structure
