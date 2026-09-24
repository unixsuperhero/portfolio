import { useEffect } from "react";
import { getDueReminders, getPrEvents, getPrs, markPrEventsSeen } from "../api.ts";
import { receiveNotifications, setNotificationPollingError } from "../lib/notifications.ts";
import type { NotificationPayload } from "../lib/notifications.ts";
import { notify } from "../native.ts";
import { playPing } from "../lib/sound.ts";

export function useNotificationPolling() {
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const errors: string[] = [];
      const [reminders, prs] = await Promise.allSettled([getDueReminders(1), getPrEvents(0)]);
      if (!live) return;
      if (reminders.status === "fulfilled") {
        const { fresh } = receiveNotifications(reminders.value.due.map(({ reminder, due_at }) => ({
          id: `reminder:${reminder.id}:${due_at}`, kind: "reminder", title: reminder.title, message: reminder.notes || "Reminder",
          reminder_id: reminder.id, due_at, task_id: reminder.task_id,
        })));
        fresh.forEach(item => { void notify(item.title, item.message); });
      } else errors.push(`Reminders: ${String(reminders.reason)}`);

      if (prs.status === "fulfilled" && prs.value.events.length) {
        const urls = new Map<number, string>();
        try {
          const lists = await getPrs();
          [...lists.mine, ...lists.review_requested, ...lists.watched, ...lists.ignored].forEach(pr => urls.set(pr.id, pr.url));
        } catch (error) { errors.push(`Pull request links: ${String(error)}`); }
        if (!live) return;
        const incoming: NotificationPayload[] = prs.value.events.map(event => ({
          id: `pr:${event.id}`, kind: "pr", title: "Pull request update", message: event.message, url: urls.get(event.pr_id) ?? null,
        }));
        const { fresh, saved } = receiveNotifications(incoming);
        fresh.forEach(item => { void notify(item.title, item.message); });
        if (fresh.length) playPing();
        if (saved) {
          try { await markPrEventsSeen(prs.value.events.map(event => event.id)); }
          catch (error) { errors.push(`Acknowledging pull request updates: ${String(error)}`); }
        }
      } else if (prs.status === "rejected") errors.push(`Pull requests: ${String(prs.reason)}`);
      if (!live) return;
      setNotificationPollingError(errors.join("\n"));
      timer = setTimeout(check, 60_000);
    };
    void check();
    return () => { live = false; clearTimeout(timer); };
  }, []);
}
