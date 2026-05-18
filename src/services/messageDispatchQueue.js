const prisma = require("../config/db");
const { dispatchCampaignCore } = require("./messageDispatchService");

let timer = null;
let isRunning = false;

async function claimNextJob() {
  const job = await prisma.messageDispatchJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { created_at: "asc" }
  });
  if (!job) return null;

  const claimed = await prisma.messageDispatchJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: { status: "RUNNING", started_at: new Date(), error: null }
  });

  if (!claimed.count) return null;
  return prisma.messageDispatchJob.findUnique({ where: { id: job.id } });
}

async function processNextJob() {
  if (isRunning) return;
  isRunning = true;
  try {
    const job = await claimNextJob();
    if (!job) return;

    try {
      const result = await dispatchCampaignCore({
        company_id: job.company_id,
        campaignId: job.campaign_id,
        user_id: job.created_by || null,
        jobId: job.id
      });

      await prisma.messageDispatchJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          finished_at: new Date(),
          processed_count: result.count,
          sent_count: result.sent_count,
          failed_count: result.failed_count,
          error: null
        }
      });
    } catch (err) {
      await prisma.messageDispatchJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finished_at: new Date(),
          error: err?.message || "Dispatch failed"
        }
      });
    }
  } finally {
    isRunning = false;
  }
}

function startMessageDispatchQueue() {
  if (timer) return;
  const intervalMs = Number(process.env.MESSAGE_QUEUE_POLL_MS || 5000);
  timer = setInterval(() => {
    processNextJob().catch((err) => console.error("message dispatch queue error:", err));
  }, intervalMs);
  setImmediate(() => {
    processNextJob().catch((err) => console.error("message dispatch queue bootstrap error:", err));
  });
}

module.exports = { startMessageDispatchQueue };
