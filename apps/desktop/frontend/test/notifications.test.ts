import { describe, expect, test } from "bun:test";
import { decodeNotifications, dismissRecords, mergeNotifications, visibleNotifications } from "../src/lib/notifications";
import type { NotificationPayload } from "../src/lib/notifications";

const reminder: NotificationPayload = { id: "reminder:1:2026-09-24T10:00:00Z", kind: "reminder", title: "Review invoices", message: "Before lunch", reminder_id: 1, due_at: "2026-09-24T10:00:00Z", task_id: null };
const pr: NotificationPayload = { id: "pr:2", kind: "pr", title: "Pull request update", message: "Checks passed", url: "https://github.com/example/project/pull/2" };

describe("notification lifecycle", () => {
  test("popup expiration preserves New history and does not extend on redelivery", () => {
    const received = mergeNotifications([], [reminder], 1000);
    const redelivered = mergeNotifications(received, [reminder], 8000);
    expect(visibleNotifications(redelivered, 8999).map(item => item.id)).toEqual([reminder.id]);
    expect(visibleNotifications(redelivered, 9000)).toEqual([]);
    expect(redelivered).toEqual([{ ...reminder, received_at: 1000, dismissed_at: null }]);
  });

  test("dismiss all includes expired popups and preserves previous dismissal times", () => {
    const received = mergeNotifications([], [reminder, pr], 1000);
    const oneDismissed = dismissRecords(received, new Set([pr.id]), 2000);
    const allDismissed = dismissRecords(oneDismissed, null, 20_000);
    expect(allDismissed.map(item => [item.id, item.dismissed_at])).toEqual([[reminder.id, 20_000], [pr.id, 2000]]);
    expect(visibleNotifications(allDismissed, 20_000)).toEqual([]);
  });

  test("dismissed history survives serialization and duplicate polling without reopening", () => {
    const dismissed = dismissRecords(mergeNotifications([], [reminder], 1000), null, 2000);
    const restored = decodeNotifications(JSON.stringify(dismissed));
    const received = mergeNotifications(restored, [reminder, pr, pr], 3000);
    expect(received).toEqual([
      { ...reminder, received_at: 1000, dismissed_at: 2000 },
      { ...pr, received_at: 3000, dismissed_at: null },
    ]);
  });

  test("a later occurrence of the same reminder remains New", () => {
    const dismissed = dismissRecords(mergeNotifications([], [reminder], 1000), null, 2000);
    const tomorrow: NotificationPayload = { ...reminder, id: "reminder:1:2026-09-25T10:00:00Z", due_at: "2026-09-25T10:00:00Z" };
    const received = mergeNotifications(dismissed, [tomorrow], 10_000);
    expect(received.filter(item => item.dismissed_at === null)).toEqual([{ ...tomorrow, received_at: 10_000, dismissed_at: null }]);
  });

  test("invalid persisted records cannot become actionable notifications", () => {
    expect(() => decodeNotifications(JSON.stringify([{ ...pr, url: "javascript:alert(1)", received_at: 1000, dismissed_at: null }]))).toThrow("Saved notification history is invalid.");
    expect(() => decodeNotifications(JSON.stringify([{ ...reminder, due_at: "not a date", received_at: 1000, dismissed_at: null }]))).toThrow("Saved notification history is invalid.");
    expect(() => decodeNotifications(JSON.stringify([{ ...pr, received_at: 1e100, dismissed_at: null }]))).toThrow("Saved notification history is invalid.");
  });
});
