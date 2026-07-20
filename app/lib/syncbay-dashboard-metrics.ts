/**
 * Aggregazioni pure per le metriche della Panoramica, separate dal servizio per
 * essere testabili senza Prisma. `summarizeReliability` calcola l'affidabilità
 * del servizio su una finestra di giorni dai job realmente registrati: totale,
 * riusciti, tasso percentuale e serie giornaliera per la sparkline. Nessun dato
 * sintetico: con zero job la finestra è vuota e il tasso è 100.
 */
export const DASHBOARD_RELIABILITY_JOB_LIMIT = 2000;

export function summarizeReliability(
  jobs: { createdAt: Date; status: string }[],
  now: Date,
  windowDays = 7,
) {
  const totalJobs = jobs.length;
  const succeededJobs = jobs.filter((job) => job.status === "SUCCEEDED").length;
  const successRate = totalJobs > 0 ? Math.round((succeededJobs / totalJobs) * 100) : 100;
  const daily: number[] = [];

  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - offset);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    daily.push(jobs.filter((job) => job.createdAt >= dayStart && job.createdAt < dayEnd).length);
  }

  return { daily, succeededJobs, successRate, totalJobs, windowDays };
}
