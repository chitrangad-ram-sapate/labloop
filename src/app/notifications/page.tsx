import Link from "next/link";
import { markAllRead } from "@/app/actions/verify";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { fmt } from "@/lib/format";

export default async function Notifications() {
  const actor = await requireActor();
  const snapshot = await getFirebaseDb().collection("notifications").where("user_id", "==", actor.id).get();
  const rows = snapshot.docs.map((doc) => fromFirestore(doc.id, doc.data())).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 100);
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <form action={markAllRead}><Button variant="outline" size="sm">Mark all read</Button></form>
      </div>
      {rows.length === 0 && <p>Nothing yet.</p>}
      <ul className="divide-y rounded-lg border">
        {rows.map((n) => (
          <li key={n.id} className={`p-3 text-sm ${n.read_at ? "" : "bg-muted/60"}`}>
            <p className="font-medium">{n.read_at ? "" : "● "}{n.link ? <Link href={n.link} className="underline">{n.title}</Link> : n.title}</p>
            {n.body && <p className="text-muted-foreground">{n.body}</p>}
            <p className="text-xs text-muted-foreground">{fmt(n.created_at)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
