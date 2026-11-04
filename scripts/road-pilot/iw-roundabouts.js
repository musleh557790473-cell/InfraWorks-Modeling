// InfraWorks Scripting Console (Ctrl+2): replace the closed roundabout roads by InfraWorks'
// own intersections. THIS WRITES TO THE MODEL.
//  1. deletes the ring roads RA-1, RA-3..RA-7 through the road API (InfraWorks updates its
//     intersections around each), then
//  2. rebuilds every road through those roundabout centres (Parsons draws their centrelines through
//     the centre), so InfraWorks forms an intersection at each centre, which can then be converted
//     to a roundabout (Autodesk help "To convert an intersection to a roundabout").
// RA-2 is left as it is: its three roads stop 3 m short of the centre (R.0.C.1 ends, R.0.C.2 and
// R.0.D.1 start there), so no intersection would form, and their levels end there.
// IDs are CONSTRAINED_DEFINITIONS.ID of the Al Qairawan working model (readRoadModel takes those).
// The console may run a script twice: a second pass finds the rings gone and skips them.
(function () {
  var RINGS = [["RA-1", 298], ["RA-3", 284], ["RA-4", 300], ["RA-5", 301], ["RA-6", 285], ["RA-7", 302]];
  var THROUGH = [ // roads through each centre (from the layout), each rebuilt once
    ["R.0.D.2", 46], ["R.1.F.2", 185], ["R.2.F.3", 73], ["R.0.D.1", 274],      // RA-1
    ["R.0.D.9", 48], ["R.0.D.14", 51], ["R.0.D.15", 184], ["R.0.D.11", 276],   // RA-3
    ["R.6.F.1", 23], ["R.0.D.10", 49], ["R.0.D.12", 50],                       // RA-4 (+ R.0.D.15)
    ["R.0.D.3", 193], ["R.0.D.4", 231], ["R.0.D.13", 258],                     // RA-5 (+ R.0.D.10)
    ["R.0.C.3", 192], ["R.0.C.4", 230], ["R.12.E.1", 272],                     // RA-6 (+ R.0.D.13)
    ["R.0.B.1", 45], ["R.0.D.5", 271]];                                        // RA-7 (+ R.0.C.4)
  var am = app.ActiveModel, rm = am.RoadModel, X = am.Intersections, out = [];
  function say(s) { out.push(String(s)); }
  function tryIt(f) { try { return { ok: true, v: f() }; } catch (e) { return { ok: false, e: String(e) }; } }
  say("-- delete rings");
  for (var i = 0; i < RINGS.length; i++) {
    var n = RINGS[i][0], id = RINGS[i][1];
    var r = tryIt(function () { return rm.readRoadModel(id); });
    if (!r.ok || r.v !== true) { say(n + ": not found (already deleted?)"); continue; }
    var ext = rm.getRoadModelExtents();
    var d = tryIt(function () { return rm.deleteRoad(); });
    var u = d.ok ? tryIt(function () { return X.updateIntersections(ext, [], [], [id], true); }) : { ok: false, e: "-" };
    say(n + ": deleteRoad " + (d.ok ? JSON.stringify(d.v) : "! " + d.e) + ", updateIntersections " + (u.ok ? "ok" : "! " + u.e));
  }
  say("-- rebuild roads through the centres");
  for (var j = 0; j < THROUGH.length; j++) {
    var m = THROUGH[j][0], k = THROUGH[j][1];
    var a = tryIt(function () { return rm.readRoadModel(k); });
    if (!a.ok || a.v !== true) { say(m + ": not loaded"); continue; }
    var g = tryIt(function () { return rm.regenModel(); }), s = g.ok ? tryIt(function () { return rm.saveUpdates(); }) : g;
    var u2 = s.ok ? tryIt(function () { return X.updateIntersections(rm.getRoadModelExtents(), [], [k], [], true); }) : s;
    say(m + ": " + (s.ok ? "saved " + JSON.stringify(s.v) : "! " + s.e) + (u2.ok ? "" : ", intersections ! " + u2.e));
  }
  var txt = out.join("\n");
  try { console.log(txt); } catch (e) {}
  return txt;
})();
