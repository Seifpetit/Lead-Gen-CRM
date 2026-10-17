import { loadEnv } from './config/env.js';

// Entry point. HTTP routes arrive in pass 5; for now this only validates configuration.
const env = loadEnv();
console.log(`backend config loaded (env=${env.NODE_ENV}, port=${env.PORT})`);
