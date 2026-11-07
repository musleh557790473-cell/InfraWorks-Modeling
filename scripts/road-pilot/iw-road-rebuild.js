// InfraWorks Scripting Console (Ctrl+2): REBUILD roads through InfraWorks' own road API, as a
// single-road edit would (body, grading, and the intersections where the road meets others).
// THIS WRITES TO THE MODEL. Default: RA-2 only (trial). Run once, then check RA-2 in InfraWorks.
//
// readRoadModel() takes the road's CONSTRAINED_DEFINITIONS.ID (RA-2: 299), not ROADS.ID (280, the
// "ID" in the properties panel): probe of 4 Nov 2026 (iw-road-probe.js).
// Signatures (AIM_JavaScriptAPI.dll): regenModel(), saveUpdates(), getRoadModelExtents() -> BBox2d,
// Intersections.updateIntersections(extents, insertedRoads, editedRoads, deletedRoads, invalidate).
// Each step's result is printed; the script stops at the first error.
(function () {
  // Al Qairawan working model, CONSTRAINED_DEFINITIONS.ID by road:
  // RA-1 298, RA-2 299, RA-3 284, RA-4 300, RA-5 301, RA-6 285, RA-7 302, R.1.G.23 227, R.2.G.5 290, R.2.G.24 294
  // Trial on RA-2 (4 Nov 2026): readRoadModel true, regenModel, saveUpdates true, updateIntersections
  // returned [] but the model went from 12 to 20 intersections (arms 41 -> 68, regions 34 -> 57), RA-2
  // got InfraWorks' own body (21 strips, 11 grading rows, a real range hash) and 6 arms, still one
  // road row; all 182 intersection links resolve. The console runs a script twice: harmless here.
  // Next: the closed roads (uncomment), then all roads.
  var ROADS = [["RA-2", 299]];
  // var ROADS = [["RA-1", 298], ["RA-3", 284], ["RA-4", 300], ["RA-5", 301], ["RA-6", 285], ["RA-7", 302], ["R.1.G.23", 227], ["R.2.G.5", 290], ["R.2.G.24", 294]];
  var UPDATE_INTERSECTIONS = true;
  var out = [];
  function say(s) { out.push(String(s)); }
  function step(label, f) { try { var v = f(); say(label + " = " + (v === undefined ? "undefined" : JSON.stringify(v))); return { ok: true, v: v }; } catch (e) { say(label + " ! " + e); return { ok: false }; } }
  var am = app.ActiveModel, rm = am.RoadModel;
  for (var i = 0; i < ROADS.length; i++) {
    var name = ROADS[i][0], id = ROADS[i][1];
    say("== " + name + " (" + id + ")");
    var r = step("readRoadModel", function () { return rm.readRoadModel(id); });
    if (!r.ok || r.v !== true) { say("stopped: road not loaded"); break; }
    var x0 = rm.getRoadModelExtents();
    if (!step("regenModel", function () { return rm.regenModel(); }).ok) break;
    if (!step("saveUpdates", function () { return rm.saveUpdates(); }).ok) break;
    if (UPDATE_INTERSECTIONS) {
      var x = step("extents", function () { var e = rm.getRoadModelExtents(); return e.IsValid ? [e.Min.X, e.Min.Y, e.Max.X, e.Max.Y] : "invalid"; });
      if (!step("updateIntersections", function () { return am.Intersections.updateIntersections(rm.getRoadModelExtents() || x0, [], [id], [], true); }).ok) break;
    }
  }
  var s = out.join("\n");
  try { console.log(s); } catch (e) {}
  return s;
})();
