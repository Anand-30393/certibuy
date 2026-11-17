// O-11 demo reset: which records may be removed. Only data that belongs entirely to seeded demo or
// test accounts goes; anything a real customer took part in (as seller or buyer) is kept, together
// with every device, order and deal linked to it.

/** Seeded demo and test accounts use this reserved domain (packages/db/seed). */
export const DEMO_EMAIL_DOMAIN = "@certibuy.test";

export function isDemoEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN));
}

export interface DemoResetInput {
  submissions: { id: string; sellerId: string }[];
  devices: { id: string; submissionId: string }[];
  orders: { id: string; buyerId: string; deviceId: string; replacementDeviceId: string | null }[];
}

export interface DemoResetPlan {
  submissionIds: string[];
  deviceIds: string[];
  orderIds: string[];
  protectedSubmissions: number;
  protectedOrders: number;
}

/**
 * A record is removable only when every person linked to it is a demo account. Protection spreads
 * through links until nothing changes: a kept order keeps its devices, a kept device keeps its deal
 * and every other order on it.
 */
export function planDemoReset(
  input: DemoResetInput,
  isDemoUser: (profileId: string) => boolean,
): DemoResetPlan {
  const sellerOf = new Map(input.submissions.map((s) => [s.id, s.sellerId]));
  const deviceSub = new Map(input.devices.map((d) => [d.id, d.submissionId]));
  const keepSub = new Set(
    input.submissions.filter((s) => !isDemoUser(s.sellerId)).map((s) => s.id),
  );
  const keepDevice = new Set<string>();
  const keepOrder = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;
    const mark = <T>(set: Set<T>, v: T) => {
      if (!set.has(v)) {
        set.add(v);
        changed = true;
      }
    };
    for (const d of input.devices) {
      const sub = deviceSub.get(d.id) as string;
      const seller = sellerOf.get(sub);
      if (keepSub.has(sub) || seller === undefined || !isDemoUser(seller)) mark(keepDevice, d.id);
      if (keepDevice.has(d.id)) mark(keepSub, sub);
    }
    for (const o of input.orders) {
      const devices = [o.deviceId, o.replacementDeviceId].filter((x): x is string => x !== null);
      const known = devices.every((d) => deviceSub.has(d));
      if (!isDemoUser(o.buyerId) || !known || devices.some((d) => keepDevice.has(d))) {
        mark(keepOrder, o.id);
      }
      if (keepOrder.has(o.id)) for (const d of devices) if (deviceSub.has(d)) mark(keepDevice, d);
    }
  }

  return {
    submissionIds: input.submissions.filter((s) => !keepSub.has(s.id)).map((s) => s.id),
    deviceIds: input.devices.filter((d) => !keepDevice.has(d.id)).map((d) => d.id),
    orderIds: input.orders.filter((o) => !keepOrder.has(o.id)).map((o) => o.id),
    protectedSubmissions: keepSub.size,
    protectedOrders: keepOrder.size,
  };
}
