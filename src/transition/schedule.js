import {dispatch} from "d3-dispatch";
import {timer, timerOnce} from "d3-timer";

export var emptyDispatch = dispatch("start", "end", "interrupt");

export function initializeScheduleEntry(node, key, id, index, group, timing) {
  var schedule = node[key];
  if (!schedule) node[key] = schedule = {active: null, pending: []};
  else if (getScheduleEntry(node, key, id)) return;
  addScheduleEntry(node, key, {
    id: id,
    index: index, // For restoring context during callbacks.
    group: group, // For restoring context during callbacks.
    dispatch: emptyDispatch,
    tweens: [],
    time: timing.time,
    delay: timing.delay,
    duration: timing.duration,
    ease: timing.ease,
    timer: null
  });
}

export function getScheduleEntry(node, key, id) {
  var schedule = node[key];
  if (!schedule) return;
  var entry = schedule.active;
  if (entry && entry.id === id) return entry;
  var pending = schedule.pending, i = pending.length;
  while (--i >= 0) if ((entry = pending[i]).id === id) return entry;
}

function addScheduleEntry(node, key, entry) {
  var schedule = node[key];

  // Initialize the entry timer when the transition is created. The delay is not
  // known until the first callback! If the delay is greater than this first
  // sleep, sleep again; otherwise, start immediately.
  schedule.pending.push(entry);
  entry.timer = timer(function(elapsed, now) {
    if (entry.delay <= elapsed) start(elapsed - entry.delay, now);
    else entry.timer.restart(start, entry.delay, entry.time);
  }, 0, entry.time);

  function start(elapsed, now) {
    var interrupted = schedule.active,
        pending = schedule.pending,
        tweens = entry.tweens,
        i, j, n, o;

    // Cancel any pre-empted transitions. No interrupt event is dispatched
    // because the cancelled transitions never started. Note that this also
    // removes this transition from the pending list!
    // TODO Would a map or linked list be more efficient here?
    for (i = 0, j = -1, n = pending.length; i < n; ++i) {
      o = pending[i];
      if (o.id < entry.id) o.timer.stop();
      else if (o.id > entry.id) pending[++j] = o;
    }
    pending.length = j + 1;

    // Mark this transition as active.
    schedule.active = entry;

    // Defer the first tick to end of the current frame; see mbostock/d3#1576.
    // Note the transition may be canceled after start and before the first tick!
    // Note this must be scheduled before the start event; see d3/d3-transition#16!
    // Assuming this is successful, subsequent callbacks go straight to tick.
    timerOnce(function() {
      if (schedule.active === entry) {
        entry.timer.restart(tick, entry.delay, entry.time);
        tick(elapsed);
      }
    }, 0, now);

    // Interrupt the active transition, if any.
    // Dispatch the interrupt event.
    // TODO Dispatch the interrupt event before updating the active transition?
    if (interrupted) {
      interrupted.timer.stop();
      interrupted.dispatch.interrupt.call(node, node.__data__, interrupted.index, interrupted.group); // TODO try-catch?
    }

    // Dispatch the start event.
    // Note this must be done before the tweens are initialized.
    entry.dispatch.start.call(node, node.__data__, entry.index, entry.group); // TODO try-catch?

    // Initialize the tweens, deleting null tweens.
    // TODO Would a map or linked list be more efficient here?
    // TODO Overwriting the tweens array could be exposed through getScheduleEntry?
    for (i = 0, j = -1, n = tweens.length; i < n; ++i) {
      if (o = tweens[i].value.call(node, node.__data__, entry.index, entry.group)) { // TODO try-catch?
        tweens[++j] = o;
      }
    }
    tweens.length = j + 1;
  }

  function tick(elapsed) {
    var tweens = entry.tweens,
        t = elapsed / entry.duration, // TODO capture duration to ensure immutability?
        e = t >= 1 ? 1 : entry.ease.call(null, t), // TODO try-catch?
        i, n;

    for (i = 0, n = tweens.length; i < n; ++i) {
      tweens[i].call(null, e); // TODO try-catch?
    }

    // Dispatch the end event.
    // TODO Dispatch the end event before clearing the active transition?
    if (t >= 1) {
      schedule.active = null;
      if (!schedule.pending.length) delete node[key];
      entry.timer.stop();
      entry.dispatch.end.call(node, node.__data__, entry.index, entry.group); // TODO try-catch
    }
  }
}
