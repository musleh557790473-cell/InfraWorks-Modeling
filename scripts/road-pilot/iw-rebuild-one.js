// InfraWorks Scripting Console (Ctrl+2): rebuild ONE road, timed. THIS WRITES TO THE MODEL.
// Trial before any batch (rule: a script must be faster than the manual way). Prints the seconds
// each step takes. updateIntersections is called with invalidate = false: with true, a run over 25
// roads sat in "Regenerating full model / Batch generating tiles" for many minutes (4 Nov 2026).
// Road: R.0.D.2 (CONSTRAINED_DEFINITIONS.ID 46), through the centre of RA-1 (ring deleted).
(function () {
  var NAME = "R.0.D.2", ID = 46, INVALIDATE = false;
  var am = app.ActiveModel, rm = am.RoadModel, out = [], t0 = Date.now(), last = t0;
  function say(s) { var now = Date.now(); out.push(((now - last) / 1000).toFixed(1) + " s  " + s); last = now; }
  function tryIt(f) { try { return { ok: true, v: f() }; } catch (e) { return { ok: false, e: String(e) }; } }
  var a = tryIt(function () { return rm.readRoadModel(ID); });
  say("readRoadModel(" + ID + ") " + (a.ok ? JSON.stringify(a.v) : "! " + a.e));
  if (a.ok && a.v === true) {
    var g = tryIt(function () { return rm.regenModel(); }); say("regenModel " + (g.ok ? "ok" : "! " + g.e));
    var s = g.ok ? tryIt(function () { return rm.saveUpdates(); }) : g; say("saveUpdates " + (s.ok ? JSON.stringify(s.v) : "! " + s.e));
    if (s.ok) { var u = tryIt(function () { return am.Intersections.updateIntersections(rm.getRoadModelExtents(), [], [ID], [], INVALIDATE); }); say("updateIntersections(invalidate " + INVALIDATE + ") " + (u.ok ? JSON.stringify(u.v) : "! " + u.e)); }
  }
  out.push("total " + ((Date.now() - t0) / 1000).toFixed(1) + " s for " + NAME);
  var txt = out.join("\n");
  try { console.log(txt); } catch (e) {}
  return txt;
})();
