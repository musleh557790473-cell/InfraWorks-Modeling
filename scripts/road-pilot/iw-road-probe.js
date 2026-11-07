// InfraWorks Scripting Console (Ctrl+2), READ-ONLY probe of one road through the road API.
// Tries which identifier app.ActiveModel.RoadModel.readRoadModel() accepts for road RA-2 in the
// Al Qairawan working model, and lists ActiveModel's selection / feature functions. It calls no save,
// regen, invalidate or update: nothing is written.
// Signatures read from AIM_JavaScriptAPI.dll (Qt metadata): readRoadModel(featureId), getRoadID(),
// isEmpty(), getRoadModelExtents() -> BBox2d, save(), saveUpdates(), invalidateModel(), regenModel(),
// Intersections.updateIntersections(extents, insertedRoads, editedRoads, deletedRoads, invalidate).
// Run 1 (4 Nov 2026): readRoadModel(280) (ROADS.ID, the "ID" in the properties panel) = false.
// Paste, Run, and read the short lines in the output pane.
(function () {
  // RA-2: ROADS.ID 280, CONSTRAINED_DEFINITIONS.ID 299, and their GUIDs
  var TRIES = [299, "299", "280", "a2ec06ed-6c09-4895-9cc2-72eb57b03020", "a7a8e062-9d21-48e2-b060-edce067da834",
    "{a2ec06ed-6c09-4895-9cc2-72eb57b03020}", "{a7a8e062-9d21-48e2-b060-edce067da834}"];
  var out = [];
  function say(s) { out.push(String(s)); }
  var am = app.ActiveModel, rm = am.RoadModel;
  // what ActiveModel offers around selection and features (names only)
  var k = [];
  try { for (var p in am) if (/sel|feature|road|find|get/i.test(p)) k.push(p); } catch (e) { k.push("<" + e + ">"); }
  say("ActiveModel sel/feature/road/find/get: " + k.join(" "));
  for (var i = 0; i < TRIES.length; i++) {
    var id = TRIES[i], r;
    try { r = rm.readRoadModel(id); } catch (e) { r = "! " + e; }
    var empty; try { empty = rm.isEmpty(); } catch (e) { empty = "! " + e; }
    say("readRoadModel(" + JSON.stringify(id) + ") = " + JSON.stringify(r) + ", isEmpty = " + empty);
    if (empty === false) {
      try { say("  getRoadID = " + rm.getRoadID()); } catch (e) { say("  getRoadID ! " + e); }
      try { var x = rm.getRoadModelExtents(); say("  extents valid " + x.IsValid + " min " + x.Min.X + "," + x.Min.Y + " max " + x.Max.X + "," + x.Max.Y); } catch (e) { say("  extents ! " + e); }
      break;
    }
  }
  var s = out.join("\n");
  try { console.log(s); } catch (e) {}
  return s;
})();
