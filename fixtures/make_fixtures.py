"""
Build the DWG test fixtures from code, so the repo carries real binary DWG files that we
authored (no third-party drawings).

    python fixtures/make_fixtures.py          # needs: pip install ezdxf ; ODA File Converter

Writes, next to this script:
  sample.dwg   — the default LDIP sample (ROADS / COVERAGES / WATER / PARCELS / ANNOTATION),
                 asset ids as XDATA (1001 INFRAWORKS / 1000 RD-00n)
  team-b.dwg   — a drawing as another team would send it: NCS-style layer names, curved
                 roads, road ids as TEXT labels, plots as blocks with a PLOT_NO attribute,
                 a title block on paper space. Coordinates: UTM 38N, metres.
"""
import os
import shutil
import subprocess
import sys
import tempfile

import ezdxf

HERE = os.path.dirname(os.path.abspath(__file__))
X0, Y0 = 673000.0, 2735000.0


def new_doc():
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 6  # metres
    doc.appids.add("INFRAWORKS")
    return doc


def sample():
    doc = new_doc()
    msp = doc.modelspace()
    for name in ["ROADS", "COVERAGES", "WATER", "PARCELS", "ANNOTATION"]:
        doc.layers.add(name)
    for n in range(1, 6):
        y = Y0 + (n - 1) * 12
        line = msp.add_line((X0, y), (X0 + 500, y + 5), dxfattribs={"layer": "ROADS"})
        line.set_xdata("INFRAWORKS", [(1000, f"RD-00{n}")])
    msp.add_lwpolyline(
        [(X0, Y0 + 80), (X0 + 200, Y0 + 80), (X0 + 200, Y0 + 110), (X0, Y0 + 110)],
        close=True, dxfattribs={"layer": "COVERAGES"},
    )
    msp.add_line((X0 + 50, Y0 + 120), (X0 + 400, Y0 + 125), dxfattribs={"layer": "WATER"})
    plot = msp.add_lwpolyline(
        [(X0 + 100, Y0 + 160), (X0 + 300, Y0 + 160), (X0 + 300, Y0 + 190), (X0 + 100, Y0 + 190)],
        close=True, dxfattribs={"layer": "PARCELS"},
    )
    plot.set_xdata("INFRAWORKS", [(1000, "PCL-001")])
    msp.add_point((X0 + 200, Y0 + 20), dxfattribs={"layer": "ANNOTATION"})
    return doc


def team_b():
    doc = new_doc()
    msp = doc.modelspace()
    for name in ["C-ROAD-CNTR", "C-ROAD-TEXT", "C-PROP-PLOT", "C-TOPO-WATR", "C-ANNO-TTLB"]:
        doc.layers.add(name)

    # Roads with a curve (bulge) in the middle; ids written as labels 3 m off the line.
    for n in range(1, 4):
        y = Y0 + 300 + (n - 1) * 60
        msp.add_lwpolyline(
            [(X0, y, 0, 0, 0), (X0 + 200, y, 0, 0, 0.25), (X0 + 300, y + 40, 0, 0, 0), (X0 + 500, y + 40, 0, 0, 0)],
            format="xyseb", dxfattribs={"layer": "C-ROAD-CNTR"},
        )
        msp.add_text(f"rd-00{n}", height=2.5, dxfattribs={"layer": "C-ROAD-TEXT", "insert": (X0 + 60, y + 3)})

    # Plots: one block per plot type, boundary drawn on layer 0 so it takes the INSERT's layer.
    blk = doc.blocks.new("PLOT_30x20", base_point=(0, 0))
    blk.add_lwpolyline([(0, 0), (30, 0), (30, 20), (0, 20)], close=True, dxfattribs={"layer": "0"})
    blk.add_attdef("PLOT_NO", insert=(2, 2), height=1.5)
    for i, (dx, rot) in enumerate([(0, 0), (40, 0), (80, 15)], start=1):
        ref = msp.add_blockref("PLOT_30x20", (X0 + dx, Y0 + 520), dxfattribs={"layer": "C-PROP-PLOT", "rotation": rot})
        ref.add_auto_attribs({"PLOT_NO": f"P-{i:03d}"})

    # A wadi as an arc.
    msp.add_arc((X0 + 250, Y0 + 650), radius=80, start_angle=200, end_angle=340, dxfattribs={"layer": "C-TOPO-WATR"})

    # Title block on paper space — must never become a feature.
    layout = doc.layouts.get("Layout1")
    layout.add_text("TITLE BLOCK — NOT MODEL CONTENT", height=5, dxfattribs={"layer": "C-ANNO-TTLB", "insert": (10, 10)})
    layout.add_line((0, 0), (420, 0), dxfattribs={"layer": "C-ANNO-TTLB"})
    return doc


def find_oda():
    env = os.environ.get("ODA_FILE_CONVERTER")
    if env:
        return env
    root = os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "ODA")
    if os.path.isdir(root):
        for d in sorted(os.listdir(root), reverse=True):
            exe = os.path.join(root, d, "ODAFileConverter.exe")
            if os.path.exists(exe):
                return exe
    sys.exit("ODA File Converter not found (set ODA_FILE_CONVERTER)")


def to_dwg(doc, name):
    oda = find_oda()
    work = tempfile.mkdtemp(prefix="iwfx-")
    try:
        os.makedirs(os.path.join(work, "in"))
        os.makedirs(os.path.join(work, "out"))
        doc.saveas(os.path.join(work, "in", name + ".dxf"))
        subprocess.run([oda, os.path.join(work, "in"), os.path.join(work, "out"), "ACAD2018", "DWG", "0", "1", name + ".dxf"], check=True)
        out = os.path.join(work, "out", name + ".dwg")
        if not os.path.exists(out):
            err = os.path.join(work, "out", name + ".dwg.err")
            sys.exit(open(err).read() if os.path.exists(err) else f"ODA produced no {name}.dwg")
        shutil.copyfile(out, os.path.join(HERE, name + ".dwg"))
        print("wrote", os.path.join(HERE, name + ".dwg"))
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    to_dwg(sample(), "sample")
    to_dwg(team_b(), "team-b")
