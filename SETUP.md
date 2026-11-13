# Setting up Cadence

Cadence is hosted on GitHub Pages only. Google is used for sign-in, Drive storage, and (optionally) Google Tasks and Calendar. There is no server, no Vercel and no database.

## 1. Publish on GitHub Pages

1. Push this repository to GitHub as `cadence` (public).
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` builds, tests and publishes to `https://<your-user>.github.io/cadence/` ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)). The repository name becomes the path automatically.

## 2. Google Cloud (one time, free)

1. Go to https://console.cloud.google.com/ and create a project, e.g. "Cadence".
2. **APIs & Services → Library**: enable **Google Drive API**, **Google Tasks API** and **Google Calendar API**.
3. **Google Auth Platform → Branding** (OAuth consent screen): app name *Cadence*, your support email, the app's address `https://<your-user>.github.io/cadence/`, privacy policy `https://<your-user>.github.io/cadence/privacy.html`. Audience: **External**.
4. **Data access → Add scopes**:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/drive.file` (non-sensitive)
   - `https://www.googleapis.com/auth/tasks` (sensitive)
   - `https://www.googleapis.com/auth/calendar.app.created` (sensitive)
   - `https://www.googleapis.com/auth/calendar.events.readonly` and `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (sensitive; only for "show my other calendars")
5. **Clients → Create client → Web application**:
   - Authorised JavaScript origins: `https://<your-user>.github.io` and, for development, `http://localhost:5173`.
   - No redirect URIs are needed (Cadence uses Google's pop-up token flow).
   - Copy the **Client ID**. It is public by design; there is no client secret to keep.
6. In the GitHub repository: **Settings → Secrets and variables → Actions → Variables → New repository variable**: `VITE_GOOGLE_CLIENT_ID` = the client ID. Re-run the deploy workflow.
   (Or leave it out and paste the client ID in Cadence under Settings → Google; it's then stored on that device only.)

For local development, put it in `.env.local`:

```bash
cp .env.example .env.local   # then fill in VITE_GOOGLE_CLIENT_ID
```

## 3. Going public: Google verification

While the app is in **Testing**, only the test users you add (up to 100) can sign in, and Google shows them a warning screen. To open Cadence to anyone:

- **Drive only** (`drive.file`) is a non-sensitive scope: publishing the app needs only brand verification (name, logo, homepage, privacy policy), usually a few days.
- **Google Tasks and Calendar** are *sensitive* scopes: Google asks for a short video showing how each permission is used and a written justification. It's free and usually takes a few weeks. Until it's done, people can still use Cadence with Drive; the Tasks and Calendar switches show Google's "unverified app" warning.
- No *restricted* scopes are used, so no security assessment is needed.

The privacy policy is at [public/privacy.html](public/privacy.html).

## How sign-in works without a server

Cadence uses Google Identity Services' token model in the browser. Google gives an access token that lasts about an hour; there is no refresh token (that would need a server). When the token runs out, sync pauses and Cadence asks Google again on your next tap (a Google window may flash), or you tap **Resume sync**. Your data is always saved on the device first, so nothing waits on Google.

## Reminders when Cadence is closed

A static site can't send push notifications on its own. Cadence turns reminders into Google Calendar events with pop-up alerts on a calendar called "Cadence", and the Google Calendar app on your phone delivers them. While Cadence is open (or installed and running), it also shows its own notifications.

## Adding tasks from other apps

Open `https://<your-user>.github.io/cadence/add?title=Read%2020%20pages&due=today&source=lumen` from anywhere. Fields: `title`, `notes`, `due`, `time`, `project`, `tags` (comma-separated), `priority` (1–4), `repeat` ("every day"), `link`, `source`.
