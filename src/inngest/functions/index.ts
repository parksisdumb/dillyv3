import { closeRepDay } from "./close-rep-day";
import { dailyBriefFanout, dailyBriefRun } from "./daily-brief";
import { managerEscalations, reminders } from "./reminders";

export const functions = [dailyBriefFanout, dailyBriefRun, closeRepDay, reminders, managerEscalations];
