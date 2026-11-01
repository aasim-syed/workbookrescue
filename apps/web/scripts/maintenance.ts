// Expires guest sandboxes and purges stale rate-limit rows. In production this runs from Vercel Cron (/api/cron/cleanup).
import { getDb } from "../server/_lib/db/client.js";
import { runMaintenance } from "../server/_lib/maintenance.js";

console.log(await runMaintenance(await getDb()));
process.exit(0);
