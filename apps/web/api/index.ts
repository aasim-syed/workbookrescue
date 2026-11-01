// Vercel Function entry. All routes live in ../server so they bundle into this single function.
import app from "../server/_app.js";

export default { fetch: app.fetch };
