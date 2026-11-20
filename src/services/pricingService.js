// Pure money math — no DB, no Stripe — so it can be unit tested directly.
// Everything is computed in integer cents; client-supplied prices are never used.

export const round2 = (value) => Math.round(Number(value) * 100) / 100;

// items: [{ productId, title, price, quantity, image, sellerId, sellerName, sellerEmail, sellerPhone }]
export function groupBySeller(items) {
  const groups = new Map();

  for (const item of items) {
    const key = item.sellerId ?? "unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        sellerInfo: {
          userId: item.sellerId ?? null,
          name: item.sellerName ?? "",
          email: item.sellerEmail ?? "",
        },
        items: [],
      });
    }
    groups.get(key).items.push({
      productId: item.productId,
      title: item.title,
      price: round2(item.price),
      quantity: item.quantity,
      image: item.image ?? null,
    });
  }

  return [...groups.values()];
}

// One delivery fee per order (per seller), charged in cents and capped by the subtotal.
export function computeTotals(groups, deliveryFee) {
  const feeCents = Math.round(Number(deliveryFee) * 100);

  return groups.map((group) => {
    const subtotalCents = group.items.reduce(
      (sum, item) => sum + Math.round(Number(item.price) * 100) * item.quantity,
      0
    );
    const deliveryCents = subtotalCents > 0 ? feeCents : 0;

    return {
      ...group,
      subtotal: subtotalCents / 100,
      deliveryFee: deliveryCents / 100,
      total: (subtotalCents + deliveryCents) / 100,
      _subtotalCents: subtotalCents,
      _deliveryCents: deliveryCents,
      _totalCents: subtotalCents + deliveryCents,
    };
  });
}

export function grandTotalCents(orderTotals) {
  const subtotal = orderTotals.reduce((sum, o) => sum + o._subtotalCents, 0);
  const delivery = orderTotals.reduce((sum, o) => sum + o._deliveryCents, 0);
  return { subtotal, delivery, total: subtotal + delivery };
}

// Drops the internal cent fields so they never reach the database.
export const publicTotals = ({ _subtotalCents, _deliveryCents, _totalCents, ...rest }) => rest;