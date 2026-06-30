# Cascadia Fishing — Setup Guide

This turns the app into a real website at a URL like `cascadia-fishing.vercel.app`,
synced across your iPhone, iPad, and desktop. 

## Part 1 — Get the code onto GitHub

1. Unzip this folder. You should see `index.html`, `package.json`, `src/`, `api/`, etc.
2. Go to your GitHub repo in the browser.
3. Click **Add file → Upload files**.
4. Drag in *everything inside* the unzipped `cascadia` folder (not the folder itself —
   the files and subfolders `src/` and `api/` need to land at the repo's root).
5. Scroll down, click **Commit changes**.

## Part 2 — Deploy it with Vercel (free)

1. Go to vercel.com and sign in (use "Continue with GitHub" — it's the easiest option
   and lets Vercel auto-deploy every time you update the repo later).
2. Click **Add New → Project**.
3. Find your repo in the list and click **Import**.
4. Vercel will auto-detect it as a Vite project. Leave all settings as default.
5. Click **Deploy**. Wait ~60 seconds.
6. You'll get a live URL, like `https://cascadia-fishing-yourname.vercel.app`.

That's it for hosting — from now on, any time you push changes to the GitHub repo,
Vercel rebuilds and redeploys automatically. No more manual steps after this.

## Part 3 — Set up Firebase (for cross-device sync)

This lets your gear/boats/outings follow you across your iPhone, iPad, and desktop.

1. Go to console.firebase.google.com → **Add project** → name it anything (e.g.
   "Cascadia Fishing") → you can decline Google Analytics if asked → **Create project**.
2. In the left sidebar: **Build → Authentication → Get started**.
3. Click the **Email/Password** provider → toggle it **Enabled** → **Save**.
4. Left sidebar: **Build → Firestore Database → Create database** → choose
   **Production mode** → pick any region → **Enable**.
5. In Firestore, click the **Rules** tab, delete everything there, and paste this:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/data/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

   Click **Publish**. (This is what guarantees your data is only ever readable by you.)

6. Click the gear icon (top left) → **Project settings** → scroll to **Your apps** →
   click the **</>** (web) icon → give it any nickname → **Register app**
   (skip "Firebase Hosting" if asked, you don't need it).
7. You'll see a code block with `apiKey: "..."` and `projectId: "..."`. Copy those two values.
8. Back in your GitHub repo, open `src/App.jsx`, find this near the very top:

   ```js
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     projectId: "YOUR_PROJECT_ID",
   };
   ```

   Replace the two placeholder strings with your real values, then commit the change
   directly in GitHub's editor (the pencil icon on the file). Vercel will auto-redeploy.

9. Open your live site → click **Create Account** → use any email/password (it doesn't
   need to be a real inbox — Firebase just needs *an* email format and 6+ character
   password). Sign in with the same account on your iPhone, iPad, and desktop and your
   gear/boats/outings will sync between them.

## Part 4 — Add your Anthropic API key (for the AI Guide)

This is separate from Firebase and separate per person — each person who uses the site
pastes their *own* key, and it's billed to *their* Anthropic account, never yours.

1. Go to console.anthropic.com/settings/keys → **Create Key**.
2. Copy the key (starts with `sk-ant-...`).
3. On the live site, go to the **Settings** tab → paste it in → **Save**.
4. Done — the AI Guide, Trip Planner, and photo fish-ID features will now work.

If you want friends to use the site too: just send them the Vercel URL. They create
their own Firebase account if they want their own synced gear log, and paste their own
Anthropic key in Settings. Nothing about their key or login is visible to you.

## Updating the site later

Any time you want to change something: edit the file in GitHub (or push from your
computer if you set up git locally), commit, and Vercel redeploys automatically in
about a minute. No need to repeat any of the steps above.
