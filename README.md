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


