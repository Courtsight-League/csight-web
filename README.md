# csight-web

Frontend-only Vite app for Courtsight.

Deployment notes:

- Deploy this as its own Vercel project with the root directory set to `csight-web`
- Set `VITE_API_BASE_URL` to your deployed API origin, for example `https://api.courtsight.ca`
- Keep only browser-safe `VITE_*` variables in this project

Key scripts:

- `npm run dev`
- `npm run build`
