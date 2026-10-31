import Link from "next/link";
import { changeCartQuantity, removeCartItem, submitCart } from "@/app/actions/cart";
import { ActionForm } from "@/components/action-form";
import { requireActor } from "@/lib/auth";
import { fromFirestore, getFirebaseDb } from "@/lib/firebase";
import { fmt } from "@/lib/format";

export default async function CartPage() {
  const actor = await requireActor();
  const snapshot = await getFirebaseDb().collection("cart_items").where("user_id", "==", actor.id).get();
  const items = await Promise.all(snapshot.docs.map(async (doc) => {
    const cart = fromFirestore(doc.id, doc.data());
    const resourceDoc = await getFirebaseDb().collection("resources").doc(String(cart.resource_id)).get();
    const resource = resourceDoc.exists ? resourceDoc.data()! : {};
    return {
      id: cart.id, quantity: cart.quantity, start_at: cart.start_at, end_at: cart.end_at, purpose_text: cart.purpose_text,
      hold_expires_at: cart.hold_expires_at, active: new Date(cart.hold_expires_at).getTime() > Date.now(),
      resource_id: cart.resource_id, name: resource.name ?? "Unavailable resource", location: resource.location ?? "",
      units_available: resource.units_available ?? 0, created_at: cart.created_at,
    };
  }));
  items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const activeCount = items.filter((item) => item.active).length;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="market-eyebrow">TEMPORARY RESOURCE HOLDS</p>
        <h1 className="text-3xl font-bold">Your booking cart</h1>
        <p className="text-sm text-muted-foreground">Each active item reserves its requested quantity for 12 minutes. Submit once to send the combined request to the resource owners.</p>
      </header>
      {items.length === 0 ? (
        <section className="space-y-3 rounded-xl border p-6">
          <p>Your cart is empty.</p>
          <Link href="/" className="underline">Explore resources</Link>
        </section>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="grid gap-4 rounded-xl border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="space-y-1">
                  <h2 className="font-semibold"><Link className="underline" href={`/resources/${item.resource_id}`}>{item.name}</Link></h2>
                  <p className="text-sm text-muted-foreground">{item.location} · {fmt(item.start_at)} – {fmt(item.end_at)}</p>
                  <p className="text-sm">{item.quantity} of {item.units_available} units · {item.purpose_text}</p>
                  <p className="text-xs">{item.active ? `Hold expires ${fmt(item.hold_expires_at)}` : "Hold expired — remove and add this resource again."}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={changeCartQuantity.bind(null, item.id)} submit="−" variant="outline" className="flex items-center gap-1">
                    <input type="hidden" name="delta" value="-1" />
                  </ActionForm>
                  <span aria-label={`Quantity ${item.quantity}`} className="min-w-6 text-center font-semibold">{item.quantity}</span>
                  <ActionForm action={changeCartQuantity.bind(null, item.id)} submit="+" variant="outline" className="flex items-center gap-1">
                    <input type="hidden" name="delta" value="1" />
                  </ActionForm>
                  <ActionForm action={removeCartItem.bind(null, item.id)} submit="Remove" variant="outline" className="flex items-center gap-1" />
                </div>
              </li>
            ))}
          </ul>
          {activeCount > 0 && activeCount === items.length ? (
            <ActionForm action={submitCart} submit={`Submit combined request (${activeCount} item${activeCount === 1 ? "" : "s"})`} />
          ) : (
            <p role="status" className="rounded-lg border p-3 text-sm">Remove expired holds and add those resources again before submitting.</p>
          )}
          <Link href="/" className="button-text">Continue exploring</Link>
        </>
      )}
    </div>
  );
}
