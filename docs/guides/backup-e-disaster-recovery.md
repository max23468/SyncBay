# Backup e disaster recovery

Supabase Free non offre backup automatici del database. SyncBay adotta quindi
un export logico cifrato settimanale, conservato fuori dal repository e fuori
dallo stesso progetto Supabase, secondo la
[documentazione backup ufficiale](https://supabase.com/docs/guides/platform/backups).

## Obiettivi e responsabilità

- RPO: massimo 7 giorni; eseguire inoltre un backup immediato prima di migration
  distruttive, backfill o compattazioni.
- RTO: 8 ore dal momento in cui maintainer, archivio cifrato, passphrase e
  database isolato sono disponibili.
- Retention minima: 8 copie settimanali; destinazione, spazio e cancellazione
  sicura restano responsabilità del maintainer.
- Prova di ripristino: trimestrale, esclusivamente su database isolato e
  dichiaratamente non-production.

Se non è disponibile una destinazione offsite cifrata affidabile, il backup è
considerato bloccato: prima di aumentare il volume o l'RPO richiesto occorre
passare a un piano/provider con backup gestiti.

## Procedura

`npm run db:backup` è sempre dry-run. L'export reale richiede
`npm run db:backup -- --apply --confirm-apply`, `DATABASE_DIRECT_URL`,
`SYNCBAY_BACKUP_OUTPUT_DIR` su destinazione offsite montata e
`SYNCBAY_BACKUP_PASSPHRASE`. L'archivio usa `pg_dump` custom cifrato
AES-256-CBC/PBKDF2; il manifest contiene solo versione formato, timestamp,
nome file e SHA-256, mai dati negoziante.

Prima di eliminare una copia verificare checksum, retention e presenza di
almeno un'altra copia valida. `npm run db:restore-check` richiede
`SYNCBAY_RESTORE_DATABASE_URL` esplicitamente non-production e
`--archive=<file>`; confronta versione PostgreSQL, hash dello schema Prisma,
manifest e checksum senza scrivere. L'eventuale ripristino reale sul target
isolato richiede anche `--apply --confirm-apply`. Non usare mai produzione come
target della prova.
