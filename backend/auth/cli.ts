import { createInterface } from 'node:readline/promises';
import { createDb } from '../data/db.js';
import { AuthService } from './service.js';

// Admin commands, run by whoever operates the server:
//   create-user <email>   reads the password from stdin, so it never lands in shell history
//   create-invite         prints a one-time invite code (shown once; only its hash is stored)
const [command, email] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const db = createDb(url);
const auth = new AuthService(db);
try {
  if (command === 'create-user' && email) {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    process.stderr.write('Password (min 12 characters): ');
    const password = (await rl.question('')).trim();
    rl.close();
    await auth.createUserAsAdmin(email, password);
    console.log(`created user ${email}`);
  } else if (command === 'create-invite') {
    const { code, expiresAt } = await auth.createInvite();
    console.log(`invite code (one use, expires ${expiresAt.toISOString()}):\n${code}`);
  } else {
    console.error('usage: cli.ts create-user <email> | create-invite');
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
