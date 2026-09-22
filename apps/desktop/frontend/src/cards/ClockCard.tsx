import { useEffect, useState } from "react";

export function ClockCard({ format = "24h" }: { format?: "24h" | "12h" }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, format === "12h" ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour12: false });
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="clock-card">
      <span className="clock-time">{time}</span>
      <span className="clock-date">{date}</span>
    </div>
  );
}
