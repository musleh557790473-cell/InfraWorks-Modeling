# Gate G3: Al Qairawan single model (9 Nov 2026)

Model: `C:\IW\Al Qairawan Roads (Parsons 6 junctions).sqlite`, proposal **Networks** active, closed:
component roads and junctions, the 23 utility sources and the 10100 layers (plots, blocks, road
reserve, asphalt; no road_centerline). Rerun after the junction-pit fix (HANDOVER session 11:
road ends tied on R.4.G.2 / R.5.G.1 / R.9.G.5 / R.10.G.2, InfraWorks rebuilds, RA-3 arm back) with
the new G3-026. Run on a copy of the closed working file. Seven runs, all **PASS, 0 warnings**.

### --package exports\Al-Qairawan-sewer-shp-v1\-hOVCRRPu0-infraworks-package.zip
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N
Package       DATA_DIR\exports\Al-Qairawan-sewer-shp-v1\-hOVCRRPu0-infraworks-package.zip

[INFO] G3-000 Summary
        2 of 2 package layer(s) found in the model (-hOVCRRPu0-infraworks-package.zip).

layer               model table   features      length (m)            offset        names
sewer_manholes      PIPE_CONNECTO 901/901       -                     0.00 m        901/901 (NAME)
sewer_pipes         PIPELINES     902/902       63156/63156           0.00 m        902/902 (NAME)

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```

### --package exports\Al-Qairawan-water-shp-v1\b-exetRbG1-infraworks-package.zip
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N
Package       DATA_DIR\exports\Al-Qairawan-water-shp-v1\b-exetRbG1-infraworks-package.zip

[INFO] G3-000 Summary
        2 of 2 package layer(s) found in the model (b-exetRbG1-infraworks-package.zip).

layer               model table   features      length (m)            offset        names
water_structures    PIPE_CONNECTO 1/1           -                     0.00 m        1/1 (NAME)
water_pipes         PIPELINES     895/895       74071/74071           0.00 m        895/895 (NAME)

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```

### --package exports\Al-Qairawan-irrigation-shp-v1\7J6yfbVPJL-infraworks-package.zip
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N
Package       DATA_DIR\exports\Al-Qairawan-irrigation-shp-v1\7J6yfbVPJL-infraworks-package.zip

[INFO] G3-000 Summary
        2 of 2 package layer(s) found in the model (7J6yfbVPJL-infraworks-package.zip).

layer               model table   features      length (m)            offset        names
irrigation_structur PIPE_CONNECTO 14/14         -                     0.00 m        14/14 (NAME)
irrigation_pipes    PIPELINES     1074/1074     51752/51752           0.00 m        1074/1074 (NAME)

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```

### --package exports\Al-Qairawan-wet-utilities-shp-v3\f6ZVj1UKeB-infraworks-package.zip
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N
Package       DATA_DIR\exports\Al-Qairawan-wet-utilities-shp-v3\f6ZVj1UKeB-infraworks-package.zip

[INFO] G3-000 Summary
        5 of 5 package layer(s) found in the model (f6ZVj1UKeB-infraworks-package.zip).

layer               model table   features      length (m)            offset        names
water_valves        PIPE_CONNECTO 818/818       -                     0.00 m        -
water_hydrants      PIPE_CONNECTO 351/351       -                     0.00 m        -
storm_pipes         PIPELINES     648/648       35892/35892           0.00 m        -
storm_manholes      PIPE_CONNECTO 663/663       -                     0.00 m        -
irrigation_valves   PIPE_CONNECTO 199/199       -                     0.00 m        -

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```

### --package exports\Al-Qairawan-dry-utilities-shp-v4\NSQr1zr2zh-infraworks-package.zip
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N
Package       DATA_DIR\exports\Al-Qairawan-dry-utilities-shp-v4\NSQr1zr2zh-infraworks-package.zip

[INFO] G3-000 Summary
        12 of 12 package layer(s) found in the model (NSQr1zr2zh-infraworks-package.zip).

layer               model table   features      length (m)            offset        names
lv_pillars          PIPE_CONNECTO 1354/1354     -                     0.00 m        -
lv_cables           PIPELINES     2317/2317     32761/32761           0.00 m        -
mv_cables           PIPELINES     149/149       37560/37560           0.00 m        -
substations         PIPE_CONNECTO 102/102       -                     0.00 m        -
street_lights       POIS          1882/1882     -                     0.00 m        -
streetlight_panels  PIPE_CONNECTO 2/2           -                     0.00 m        -
streetlight_cables  PIPELINES     203/203       99833/99833           0.00 m        -
telecom_ducts       PIPELINES     510/510       68622/68622           0.00 m        -
telecom_handholes   PIPE_CONNECTO 455/455       -                     0.00 m        -
cctv_cameras        POIS          685/685       -                     0.00 m        -
security_handholes  PIPE_CONNECTO 269/269       -                     0.00 m        -
security_ducts      PIPELINES     352/352       66801/66801           0.00 m        -

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```

### --package exports\Al-Qairawan-10100-shp-v4\oDe7OMJllY-infraworks-package.zip
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N
Package       DATA_DIR\exports\Al-Qairawan-10100-shp-v4\oDe7OMJllY-infraworks-package.zip

[INFO] G3-000 Summary
        4 of 4 package layer(s) found in the model (oDe7OMJllY-infraworks-package.zip).

layer               model table   features      length (m)            offset        names
asphalt             COVERAGES     9/9           -                     0.00 m        -
blocks              COVERAGES     171/171       -                     0.00 m        -
road_reserve        COVERAGES     1/1           -                     0.00 m        -
plots               PARCELS       6555/6555     -                     0.00 m        5944/5944 (NAME)

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```

### --layout ACAD-LDIP-RCRC-SAP-01-AQ-ROD-DWG-10200-001-0A.dxf
```

────────────────────────────────────────────────────────────────────────
Schema        17.18.0   CRS UTM84-38N

[INFO] G3-020 Drawn roads in the model
        All 243 drawn roads are in the model (235 roads; merged pairs recorded in their Description).

[INFO] G3-021 Intersection links
        Every intersection arm and region points at a road definition.

[INFO] G3-022 Junction rows left over
        No junction rows left over.

[INFO] G3-023 Roundabout rows
        6 roundabout(s) and 297 intersection(s), rows consistent.

[INFO] G3-024 Roundabout arms built
        Every roundabout arm has a blend point and a clean status.

[INFO] G3-025 Kerb returns as drawn
        642 corners: 620 at the drawn radius, 0 differ, 22 without a drawn arc.

[INFO] G3-026 Roundabout arms present
        Every road reaching a roundabout centre has an arm there.

────────────────────────────────────────────────────────────────────────
PASS — 0 warning(s).
```
