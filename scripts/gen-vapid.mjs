// Gera as chaves VAPID (identidade do servidor de avisos) e um CRON_SECRET.
// Uso: npm run vapid   → copie as 4 linhas para as variáveis de ambiente da Vercel.
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:seu-email@exemplo.com");
console.log(`CRON_SECRET=${randomBytes(32).toString("base64url")}`);
console.error("\nGuarde a chave privada e o CRON_SECRET como segredos. Nunca os coloque no repositório.");
