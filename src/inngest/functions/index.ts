import { closeRepDay } from "./close-rep-day";
import { dailyBriefFanout, dailyBriefRun } from "./daily-brief";
import { mailSyncFanout, mailSyncRun } from "./mail-sync";
import { managerEscalations, reminders } from "./reminders";

export const functions = [dailyBriefFanout, dailyBriefRun, closeRepDay, reminders, managerEscalations, mailSyncFanout, mailSyncRun];
