/**
 * Creates an owner/admin account with MFA. Prints an otpauth:// URL to add to an
 * authenticator app. Usage: npx tsx scripts/create-admin.mts owner@example.com "Felicia Stefan" owner
 * The password is read from ADMIN_PASSWORD (never pass secrets on the command line).
 */
import { createDb, migrate } from "../src/lib/db/client.ts";
import { createUser, type Role } from "../src/lib/auth/auth.ts";

const [email, name, role = "owner"] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password) {
  console.error('Usage: ADMIN_PASSWORD=... npx tsx scripts/create-admin.mts <email> "<name>" [owner|admin|staff|viewer]');
  process.exit(1);
}
const db = await createDb();
await migrate(db);
const r = await createUser(db, { email, name, role: role as Role, password });
console.log(`Created ${role} ${email}.`);
if (r.otpauthUrl) console.log(`Add this to your authenticator app (shown once):\n${r.otpauthUrl}`);
process.exit(0);
