# No Saints Kitchen Checks

A home-screen web app for No Saints BBQ at The Malt Shovel. It covers temperature rounds, cooking, hot-holding and reheating, deliveries, cleaning, and opening and closing checks. It also keeps a records archive you can show an inspector.

- **Hosting:** GitHub Pages serves the files in this folder as a static site.
- **Records:** stored in Supabase (`kitchen_checks` table). Records can be added but never edited or deleted. Only signed-in users whose email is on the `staff` table can read or add them.
- **Offline:** a check saved without signal is kept on the phone and sent automatically when signal returns. The sync pill in the header shows how many are still waiting.
- **Schema:** `supabase/001_kitchen_checks.sql`.
- **Adding a staff member:** in Supabase → SQL editor, run `insert into staff(email,name) values ('their@email','Name');`. They then use "Create an account" in the app with that email.

**Status:** trial. Keep the paper records as the official record until the app has been proven and approved.
