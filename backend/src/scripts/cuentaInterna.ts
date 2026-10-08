/**
 * Marca (o desmarca) una cuenta como interna o de prueba: sus pasos dejan de
 * sumar al embudo por origen (embudo_diario, /admin/origen).
 *
 *   npm run cuenta:interna -- <email>            marca
 *   npm run cuenta:interna -- <email> --quitar   desmarca
 *
 * No borra lo que la cuenta ya sumo antes de marcarla: eso se corrige a mano.
 */
import { prisma } from '../lib/prisma';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email || email.startsWith('--')) {
    console.error('Uso: npm run cuenta:interna -- <email> [--quitar]');
    process.exitCode = 1;
    return;
  }
  const interna = !process.argv.includes('--quitar');
  const r = await prisma.user.updateMany({ where: { email: email.toLowerCase() }, data: { cuentaInterna: interna } });
  console.log(r.count ? `${email}: ${interna ? 'marcada como interna' : 'ya no es interna'}` : `${email}: no existe`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
