// Collection names. `user`/`session`/`account` are owned by Better Auth (client repo) —
// we only read `user` here, so it is listed but never created or indexed by us.
export const collections = {
  user: "user",
  products: "products",
  orders: "orders",
  payments: "payments",
  reviews: "reviews",
  wishlist: "wishlist",
  categories: "categories",
  reports: "reports",
  notifications: "notifications",
};

// createIndexes is idempotent: MongoDB ignores an existing index with the same key+options.
export async function createIndexes(db) {
  await Promise.all([
    db.collection(collections.products).createIndexes([
      { key: { title: "text", description: "text" } },
      { key: { category: 1, price: 1 } },
      { key: { "sellerInfo.userId": 1 } },
      { key: { status: 1, createdAt: -1 } },
      { key: { slug: 1 }, unique: true },
    ]),
    db.collection(collections.orders).createIndexes([
      { key: { "buyerInfo.userId": 1, createdAt: -1 } },
      { key: { "sellerInfo.userId": 1, createdAt: -1 } },
      { key: { orderStatus: 1 } },
    ]),
    db.collection(collections.payments).createIndexes([
      // partial: unpaid rows have no transactionId yet and must not collide on null
      {
        key: { transactionId: 1 },
        unique: true,
        partialFilterExpression: { transactionId: { $type: "string" } },
      },
      { key: { buyerId: 1, createdAt: -1 } },
    ]),
    db.collection(collections.reviews).createIndexes([
      { key: { orderId: 1, productId: 1 }, unique: true },
      { key: { productId: 1, createdAt: -1 } },
    ]),
    db.collection(collections.wishlist).createIndexes([
      { key: { userId: 1, productId: 1 }, unique: true },
    ]),
    db.collection(collections.categories).createIndexes([
      { key: { slug: 1 }, unique: true },
    ]),
    db.collection(collections.reports).createIndexes([
      { key: { status: 1, createdAt: -1 } },
    ]),
    db.collection(collections.notifications).createIndexes([
      { key: { userId: 1, isRead: 1, createdAt: -1 } },
    ]),
  ]);
}