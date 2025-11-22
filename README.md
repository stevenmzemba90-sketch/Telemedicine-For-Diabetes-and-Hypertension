# Telemedicine For Diabetes and Hypertension Management

Open `index.html` in your browser to view the landing page UI.

Quick steps:

```
# On Windows, from the folder:
start index.html
```

Files:
- `index.html` — main page
- `styles.css` — styling for the container, cross and buttons

Supabase integration
--------------------

This project includes `app.js` which can store consultation records in a Supabase table called `consultations`.

1. Create a free Supabase project at https://app.supabase.com
2. Create a table named `consultations` with columns (suggested):
	- `consultation_code` (text, primary key)
	- `patient_name` (text)
	- `phone` (text)
	- `cashier_registered_at` (timestamp)
	- `provider_notes` (text)
	- `medication_refill` (boolean)
	- `pharmacy_dispensed` (boolean)
	- `status` (text)
	- `created_at` (timestamp, default now)

3. In `app.js` replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your project's values.

If the constants are left as the placeholders, the app will automatically use a `localStorage` fallback so you can test flows without a Supabase account.

Open the page and use the forms to simulate the workflow: cashier -> provider -> pharmacist -> admin.

Local backend (optional)
------------------------

To run a small local queue server that will accept queued records (useful when internet is intermittent):

1. Install dependencies and start server:

```bash
cd "C:/Users/MZEMBA/Desktop/Telemedicine APP"
npm install
npm start
```

2. The server listens on `http://localhost:4000/queue` and stores items to `data/queue.json`.

Behavior summary
- Cashier form now collects `name`, `age`, `sex`, `village`, two contacts and `HIV status`.
- All records are immediately saved locally to `localStorage` under `consultations`.
- If Supabase is configured the app attempts to write directly; if not, records are placed into an `outbox` and POSTed to the local backend at `/queue` when available.
- When the browser regains connectivity, the app will try to sync the outbox to Supabase (if keys set) or keep it in the backend queue.

Deployment & sharing notes
--------------------------

- Create a Supabase project and set up the `consultations` table and Policies.
- Do NOT commit your Supabase keys. Copy `config.example.js` to `config.js` and set your `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Add `config.js` to `.gitignore` (already included).
- To share this app publicly via GitHub:
	- Commit the repository without `config.js` and without `node_modules`.
	- Add deployment instructions or a GitHub Pages workflow if you want to host the static site directly.

Supabase security reminder
-------------------------

Supabase exposes a database; by default the anon key is client-side and requires you to configure Row Level Security (RLS) rules and policies to protect user data. For testing you can allow open inserts, but for production you should:

- Enable RLS on tables and add policies that limit access by authenticated users or specific roles.
- Use Supabase Edge Functions or a server-side relay to perform privileged operations if needed.

Next steps
----------

1. Copy `config.example.js` -> `config.js` and set your Supabase project's URL and anon key.
2. Open `index.html` in the browser. The app will use Supabase when keys are set.
3. If you need help configuring RLS or automating deployment to GitHub Pages or Vercel, ask and I can add example steps or workflows.

Local backend notifications and SMS
----------------------------------

This repository includes a simple local backend `server.js` that accepts queued consultation records at `/queue` and also exposes `/notify` and `/sms` endpoints:

- `POST /notify` — store role-targeted notifications (saved to `data/notifications.json`).
- `POST /sms` — saves SMS attempts to `data/sms.json`. If you set the environment variables `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM`, the server will try to send SMS via Twilio.

To enable SMS (optional): set the env vars and restart the server. The server performs a best-effort send and logs results locally.


