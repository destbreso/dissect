// Publish and subscribe. The orders service publishes an "order placed" event
// and gets on with its work: the broker keeps the event and delivers a copy to
// every subscription, each with its own queue and its own consumers. Email
// calls an outside provider that is slow and fails now and then (it retries
// with a backoff and, after three tries, gives the message to a dead-letter
// queue); inventory reserves stock in a few milliseconds; analytics counts the
// order with one consumer. The lesson is decoupling: the publisher never waits
// for a subscriber, and a subscriber in trouble only grows its own backlog.
// Take Email down for a while and watch which queues move. Numbers: about 50
// orders a second, a provider that answers in 120 ms at the median and fails 6%
// of the time, twelve email consumers.

export default {
  id: "pubsub",
  title: "One event, three subscribers",
  item: "message",
  about: "The orders service publishes an event once. The broker delivers a copy to each subscription: email, inventory and analytics each read their own queue, at their own pace.",
  unit: "ms",
  seed: 5,
  horizon: 2400,
  lanes: [
    { id: "pub", label: "Orders" },
    { id: "broker", label: "Broker" },
    { id: "email", label: "Email" },
    { id: "stock", label: "Inventory" },
    { id: "stats", label: "Analytics" },
  ],
  parts: [
    { id: "order", kind: "start", lane: "pub", at: [0, 0], label: "order placed", every: "exp 20", about: "About 50 orders a second." },
    { id: "publish", kind: "station", lane: "pub", at: [1, 0], label: "Publish", glyph: "mail", servers: "inf", work: "logn 2 6", about: "The orders service writes the event to the broker and waits only for the broker to say it has it." },
    { id: "topic", kind: "split", lane: "broker", at: [2, 0], label: "topic", fanout: true, about: "One copy for every subscription. Each copy goes on alone." },
    { id: "send", kind: "station", lane: "email", at: [3, 0], label: "Send receipt", glyph: "mail", servers: 12, work: "logn 120 400", fail: 0.06, failLabel: "provider errors", about: "Twelve consumers call the email provider: 120 ms at the median, 400 ms on a bad call, and 6% of calls fail." },
    { id: "backoff", kind: "timer", lane: "email", at: [3, 1], label: "back off", wait: "uni 200 400", about: "A failed message is put back on the queue after a pause, so a struggling provider gets room to recover." },
    { id: "sent", kind: "end", lane: "email", at: [4, 0], label: "receipt sent" },
    { id: "dlq", kind: "end", lane: "email", at: [4, 1], label: "dead letters", outcome: "fail", about: "After three failed tries the message is parked here for a person to look at." },
    { id: "reserve", kind: "station", lane: "stock", at: [3, 0], label: "Reserve stock", glyph: "db", servers: 2, work: "logn 6 20", about: "Two consumers update the stock table: a few milliseconds each." },
    { id: "reserved", kind: "end", lane: "stock", at: [4, 0], label: "stock held" },
    { id: "count", kind: "station", lane: "stats", at: [3, 0], label: "Count order", glyph: "search", servers: 1, work: "logn 10 25", about: "One consumer adds the order to the day's numbers." },
    { id: "counted", kind: "end", lane: "stats", at: [4, 0], label: "counted" },
  ],
  routes: [
    { from: "order", to: "publish" },
    { from: "publish", to: "topic", latency: 0.5 },
    { from: "topic", to: "send", latency: 1 },
    { from: "topic", to: "reserve", latency: 1 },
    { from: "topic", to: "count", latency: 1 },
    { from: "send", to: "sent", when: "ok", label: "" },
    { id: "retry", from: "send", to: "backoff", when: "fail", max: 2, label: "retry ≤2" },
    { id: "give-up", from: "send", to: "dlq", when: "fail", label: "3rd failure", seldom: true },
    { from: "backoff", to: "send" },
    { from: "reserve", to: "reserved" },
    { from: "count", to: "counted" },
  ],
  claims: [
    { metric: "send.utilization", min: 0.3, max: 0.9, say: "email keeps up, with a backlog that comes and goes" },
    { metric: "count.utilization", min: 0.5, max: 0.92, say: "the lone analytics consumer is busy but keeps up" },
  ],
};

export const figure = {
  fig: "Fig 4",
  pace: 25,
  caption: ({ run, sim, fmt }) => {
    // delivery time per subscriber: from the order to the end of its copy
    const born = new Map();
    const by = {};
    for (const r of sim.log) {
      if (r.k === "born") born.set(r.tok, r.t);
      if (r.k === "done") (by[r.at] ||= []).push(r.t - born.get(r.tok.split(".")[0]));
    }
    const med = (xs) => (xs?.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
    const pub = run.stations.publish;
    const retries = sim.log.filter((r) => r.k === "wait" && r.at === "backoff").length;
    return `The orders service spends ${fmt(pub.meanWork)} per event and never waits for a subscriber. From the order, stock is held in ${fmt(med(by.reserved))} and the order counted in ${fmt(med(by.counted))} at the median, while a receipt takes ${fmt(med(by.sent))}: email waits on its provider, and ${retries} of its deliveries needed a retry. Give Email an outage: its queue grows and its retries pile up, and the other two lanes do not notice.`;
  },
};
